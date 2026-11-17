"""Récupération périodique du bulletin et mémorisation des derniers résultats."""
from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util
from homeassistant.util import slugify

from .api import OrobnatClient, OrobnatError
from .const import (
    CONF_COMMUNE,
    CONF_DEPARTEMENT,
    CONF_REGION,
    CONF_RESEAU,
    DEFAULT_TZ,
    DOMAIN,
    REGION_TZ,
    UPDATE_INTERVAL,
)

_LOGGER = logging.getLogger(__name__)


class OrobnatCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Données exposées :

    - ``infos`` : informations générales et conformité du dernier bulletin ;
    - ``date`` : date du prélèvement (ISO 8601, avec fuseau) ou None ;
    - ``analyses`` : lignes du dernier bulletin ;
    - ``parametres`` : dernière valeur connue de chaque paramètre, même s'il
      n'a pas été mesuré lors du dernier prélèvement (certains prélèvements
      ne portent que sur quelques paramètres).
    """

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN} {entry.title}",
            update_interval=UPDATE_INTERVAL,
            config_entry=entry,
        )
        self.entry = entry
        self._store: Store[dict[str, Any]] = Store(hass, 1, f"{DOMAIN}.{entry.entry_id}")
        self._parametres: dict[str, dict[str, str]] = {}
        self._tz = dt_util.get_time_zone(
            REGION_TZ.get(entry.data[CONF_REGION], DEFAULT_TZ)
        )

    async def async_load(self) -> None:
        stored = await self._store.async_load()
        if stored:
            self._parametres = stored.get("parametres", {})

    def _fetch(self):
        d = self.entry.data
        with OrobnatClient(d[CONF_REGION]) as client:
            return client.bulletin(d[CONF_DEPARTEMENT], d[CONF_COMMUNE], d[CONF_RESEAU])

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            bulletin = await self.hass.async_add_executor_job(self._fetch)
        except OrobnatError as err:
            raise UpdateFailed(f"Orobnat : {err}") from err

        if not bulletin.analyses and not bulletin.infos:
            raise UpdateFailed("Aucun bulletin publié pour ce réseau")

        date = bulletin.date_prelevement
        date_iso = date.replace(tzinfo=self._tz).isoformat() if date else None

        for analyse in bulletin.analyses:
            self._parametres[slugify(analyse.parametre)] = {
                **asdict(analyse),
                "date": date_iso,
            }
        await self._store.async_save({"parametres": self._parametres})

        return {
            "infos": bulletin.infos,
            "date": date_iso,
            "analyses": [asdict(a) for a in bulletin.analyses],
            "parametres": dict(self._parametres),
        }
