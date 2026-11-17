"""Qualité de l'eau potable en France, depuis le site Orobnat du ministère de la Santé."""
from __future__ import annotations

from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType

from .const import CARD_URL, DOMAIN, VERSION
from .coordinator import OrobnatCoordinator

PLATFORMS = [Platform.SENSOR]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

type OrobnatConfigEntry = ConfigEntry[OrobnatCoordinator]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Publie la carte Lovelace fournie avec l'intégration."""
    card = Path(__file__).parent / "www" / "qualite-eau-card.js"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(CARD_URL, str(card), True)]
    )
    add_extra_js_url(hass, f"{CARD_URL}?v={VERSION}")
    return True


async def async_setup_entry(hass: HomeAssistant, entry: OrobnatConfigEntry) -> bool:
    coordinator = OrobnatCoordinator(hass, entry)
    await coordinator.async_load()
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: OrobnatConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await Store(hass, 1, f"{DOMAIN}.{entry.entry_id}").async_remove()
