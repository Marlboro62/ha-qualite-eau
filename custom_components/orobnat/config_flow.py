"""Assistant de configuration : région → département → commune → réseau."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)

from .api import REGIONS, OrobnatClient, OrobnatError
from .const import (
    CONF_COMMUNE,
    CONF_MA_COMMUNE,
    CONF_COMMUNE_NOM,
    CONF_DEPARTEMENT,
    CONF_REGION,
    CONF_RESEAU,
    CONF_RESEAU_NOM,
    DOMAIN,
)


def _selector(options: list[tuple[str, str]]) -> SelectSelector:
    return SelectSelector(
        SelectSelectorConfig(
            options=[SelectOptionDict(value=v, label=l) for v, l in options],
            mode=SelectSelectorMode.DROPDOWN,
            sort=False,
        )
    )


class OrobnatConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OrobnatOptionsFlow:
        return OrobnatOptionsFlow()

    def __init__(self) -> None:
        self._data: dict[str, str] = {}
        self._options: list[tuple[str, str]] = []

    async def _call(self, fn, *args):
        def run():
            with OrobnatClient(self._data[CONF_REGION]) as client:
                return getattr(client, fn)(*args)

        return await self.hass.async_add_executor_job(run)

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            self._data[CONF_REGION] = user_input[CONF_REGION]
            return await self.async_step_departement()

        regions = sorted(REGIONS.items(), key=lambda kv: kv[1])
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({vol.Required(CONF_REGION): _selector(regions)}),
        )

    async def async_step_departement(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            self._data[CONF_DEPARTEMENT] = user_input[CONF_DEPARTEMENT]
            return await self.async_step_commune()

        try:
            self._options = await self._call("departements")
        except OrobnatError:
            return self.async_abort(reason="cannot_connect")
        if len(self._options) == 1:
            self._data[CONF_DEPARTEMENT] = self._options[0][0]
            return await self.async_step_commune()
        return self.async_show_form(
            step_id="departement",
            data_schema=vol.Schema(
                {vol.Required(CONF_DEPARTEMENT): _selector(self._options)}
            ),
        )

    async def async_step_commune(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            self._data[CONF_COMMUNE] = user_input[CONF_COMMUNE]
            self._data[CONF_COMMUNE_NOM] = dict(self._options).get(
                user_input[CONF_COMMUNE], user_input[CONF_COMMUNE]
            )
            return await self.async_step_reseau()

        try:
            self._options = await self._call("communes", self._data[CONF_DEPARTEMENT])
        except OrobnatError:
            return self.async_abort(reason="cannot_connect")
        return self.async_show_form(
            step_id="commune",
            data_schema=vol.Schema({vol.Required(CONF_COMMUNE): _selector(self._options)}),
        )

    async def async_step_reseau(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return await self._create(user_input[CONF_RESEAU])

        try:
            self._options = await self._call(
                "reseaux", self._data[CONF_DEPARTEMENT], self._data[CONF_COMMUNE]
            )
        except OrobnatError:
            return self.async_abort(reason="cannot_connect")
        if not self._options:
            return self.async_abort(reason="no_reseau")
        if len(self._options) == 1:
            return await self._create(self._options[0][0])
        return self.async_show_form(
            step_id="reseau",
            data_schema=vol.Schema({vol.Required(CONF_RESEAU): _selector(self._options)}),
            description_placeholders={"commune": self._data[CONF_COMMUNE_NOM]},
        )

    async def _create(self, reseau: str) -> ConfigFlowResult:
        self._data[CONF_RESEAU] = reseau
        self._data[CONF_RESEAU_NOM] = dict(self._options).get(reseau, reseau)
        await self.async_set_unique_id(f"{self._data[CONF_COMMUNE]}_{reseau}")
        self._abort_if_unique_id_configured()

        commune = self._data[CONF_COMMUNE_NOM].title()
        title = commune
        if len(self._options) > 1:
            title = f"{commune} – {self._data[CONF_RESEAU_NOM]}"
        return self.async_create_entry(title=title, data=dict(self._data))


class OrobnatOptionsFlow(OptionsFlow):
    """Options : seulement les prélèvements faits dans la commune choisie."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Optional(
                        CONF_MA_COMMUNE,
                        default=self.config_entry.options.get(CONF_MA_COMMUNE, False),
                    ): bool,
                }
            ),
            description_placeholders={
                "commune": self.config_entry.data.get(CONF_COMMUNE_NOM, ""),
            },
        )
