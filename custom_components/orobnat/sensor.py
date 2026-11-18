"""Capteurs : bulletin (avec tout le détail pour la carte), date, un capteur par paramètre."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import OrobnatConfigEntry
from .api import parse_valeur
from .const import (
    ATTRIBUTION,
    CONF_COMMUNE_NOM,
    CONF_RESEAU,
    CONF_RESEAU_NOM,
    DOMAIN,
)
from .coordinator import OrobnatCoordinator

ORO_URL = "https://orobnat.sante.gouv.fr/orobnat/afficherPage.do?methode=menu&usd=AEP&idRegion={}"

# Préfixe de l'identifiant du paramètre (slug) -> icône.
ICONS = {
    "nitrates": "mdi:molecule",
    "nitrites": "mdi:molecule",
    "chlore": "mdi:water-plus",
    "temperature": "mdi:thermometer-water",
    "titre_hydrotimetrique": "mdi:water-opacity",
    "conductivite": "mdi:flash-triangle",
    "turbidite": "mdi:blur",
    "escherichia": "mdi:bacteria",
    "bact": "mdi:bacteria",
    "enterocoques": "mdi:bacteria",
    "calcium": "mdi:flask",
    "magnesium": "mdi:flask",
}


async def async_setup_entry(
    hass: HomeAssistant,
    entry: OrobnatConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator = entry.runtime_data
    async_add_entities([BulletinSensor(coordinator), DatePrelevementSensor(coordinator)])

    known: set[str] = set()

    @callback
    def _add_new_parametres() -> None:
        new = [k for k in (coordinator.data or {}).get("parametres", {}) if k not in known]
        known.update(new)
        if new:
            async_add_entities(ParametreSensor(coordinator, k) for k in new)

    _add_new_parametres()
    entry.async_on_unload(coordinator.async_add_listener(_add_new_parametres))


class _Base(CoordinatorEntity[OrobnatCoordinator], SensorEntity):
    _attr_has_entity_name = True
    _attr_attribution = ATTRIBUTION

    def __init__(self, coordinator: OrobnatCoordinator, key: str) -> None:
        super().__init__(coordinator)
        entry = coordinator.entry
        self._attr_unique_id = f"{entry.unique_id}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.unique_id or entry.entry_id)},
            name=f"Eau {entry.title}",
            manufacturer="Ministère de la Santé – ARS",
            model=entry.data.get(CONF_RESEAU_NOM),
            serial_number=entry.data.get(CONF_RESEAU),
            entry_type=DeviceEntryType.SERVICE,
            configuration_url=ORO_URL.format(entry.data["region"]),
        )


class BulletinSensor(_Base):
    """État : « Conforme » / « Non conforme ». Attributs : tout le bulletin."""

    _attr_translation_key = "bulletin"
    _attr_icon = "mdi:water-check"
    _unrecorded_attributes = frozenset({"analyses", "conclusions"})

    def __init__(self, coordinator: OrobnatCoordinator) -> None:
        super().__init__(coordinator, "bulletin")

    @property
    def native_value(self) -> str | None:
        infos = self.coordinator.data.get("infos", {})
        flags = [
            infos.get("Conformité bactériologique"),
            infos.get("Conformité physico-chimique"),
        ]
        flags = [f.lower() for f in flags if f]
        if not flags:
            return None
        return "Conforme" if all(f == "oui" for f in flags) else "Non conforme"

    @property
    def icon(self) -> str:
        return "mdi:water-check" if self.native_value != "Non conforme" else "mdi:water-alert"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        data = self.coordinator.data
        infos = data.get("infos", {})
        entry = self.coordinator.entry
        return {
            "commune": entry.data.get(CONF_COMMUNE_NOM),
            "reseau": entry.data.get(CONF_RESEAU_NOM),
            "date_prelevement": data.get("date"),
            "commune_prelevement": infos.get("Commune de prélèvement"),
            # option « prélèvements de ma commune » : rang du bulletin (0 = dernier du réseau) et résultat
            "bulletins_remontes": data.get("position", 0),
            "prelevement_dans_la_commune": data.get("commune_trouvee"),
            "installation": infos.get("Installation"),
            "distributeur": infos.get("Responsable de distribution"),
            "conclusions": infos.get("Conclusions sanitaires"),
            "conformite_bacteriologique": infos.get("Conformité bactériologique"),
            "conformite_physico_chimique": infos.get("Conformité physico-chimique"),
            "respect_references_qualite": infos.get("Respect des références de qualité"),
            "analyses": data.get("analyses", []),
            "source": ORO_URL.format(entry.data["region"]),
        }


class DatePrelevementSensor(_Base):
    _attr_translation_key = "date_prelevement"
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_icon = "mdi:calendar-check"

    def __init__(self, coordinator: OrobnatCoordinator) -> None:
        super().__init__(coordinator, "date_prelevement")

    @property
    def native_value(self) -> datetime | None:
        raw = self.coordinator.data.get("date")
        return datetime.fromisoformat(raw) if raw else None


class ParametreSensor(_Base):
    """Dernière valeur connue d'un paramètre d'analyse."""

    def __init__(self, coordinator: OrobnatCoordinator, key: str) -> None:
        super().__init__(coordinator, key)
        self._key = key
        p = self._p
        self._attr_name = p["parametre"].rstrip(" *").strip()
        if key == "ph":
            self._attr_icon = "mdi:ph"
        else:
            self._attr_icon = next(
                (icon for k, icon in ICONS.items() if key.startswith(k)),
                "mdi:test-tube",
            )
        valeur, unite, _ = parse_valeur(p["valeur"])
        self._numeric = valeur is not None
        if self._numeric:
            self._attr_native_unit_of_measurement = unite
            self._attr_state_class = SensorStateClass.MEASUREMENT
            if unite == "°C":
                self._attr_device_class = SensorDeviceClass.TEMPERATURE

    @property
    def suggested_display_precision(self) -> int | None:
        """Autant de décimales que le site en publie (« 39 » -> 0, « 0,43 » -> 2).

        Une valeur sous le seuil (« <0,01 ») vaut 0 : affichée « 0 », pas « 0,00 ».
        """
        if not self._numeric:
            return None
        raw = self._p["valeur"]
        if raw.strip().startswith("<"):
            return 0
        m = re.search(r"\d+(?:[.,](\d+))?", raw)
        return len(m.group(1)) if m and m.group(1) else 0

    @property
    def _p(self) -> dict[str, str]:
        return self.coordinator.data["parametres"][self._key]

    @property
    def native_value(self) -> float | str | None:
        raw = self._p["valeur"]
        valeur, _, _ = parse_valeur(raw)
        if self._numeric:
            return valeur
        return raw[:255]

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        p = self._p
        _, _, signe = parse_valeur(p["valeur"])
        attrs = {
            "valeur_brute": p["valeur"],
            "date_prelevement": p.get("date"),
            "inferieur_au_seuil": signe == "<",
            "terrain": p["parametre"].endswith("*"),
        }
        if any(c.isdigit() for c in p.get("limite", "")):
            attrs["limite_qualite"] = p["limite"]
        if any(c.isdigit() for c in p.get("reference", "")):
            attrs["reference_qualite"] = p["reference"]
        return attrs
