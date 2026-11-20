"""Constantes de l'intégration Qualité de l'eau (Orobnat)."""
from datetime import timedelta

DOMAIN = "orobnat"
VERSION = "1.1.3"

CONF_REGION = "region"
CONF_DEPARTEMENT = "departement"
CONF_COMMUNE = "commune"
CONF_COMMUNE_NOM = "commune_nom"
CONF_RESEAU = "reseau"
CONF_RESEAU_NOM = "reseau_nom"
# Option : seulement les prélèvements faits dans la commune choisie. Un réseau dessert souvent plusieurs
# communes et l'ARS prélève tour à tour dans chacune : le dernier bulletin du réseau peut venir d'une voisine.
CONF_MA_COMMUNE = "ma_commune"
# Bulletins précédents parcourus au plus pour trouver un prélèvement de la commune (Orobnat n'a pas de fin :
# posPLV=400 renvoie encore un bulletin de 2014), et âge maximal d'un bulletin retenu
MA_COMMUNE_MAX_BULLETINS = 20
MA_COMMUNE_MAX_AGE_DAYS = 730

# Les bulletins sont publiés tous les quelques jours ou semaines :
# inutile d'interroger le site plus souvent.
UPDATE_INTERVAL = timedelta(hours=12)

ATTRIBUTION = "Données : ministère de la Santé / ARS (orobnat.sante.gouv.fr)"

CARD_URL = f"/{DOMAIN}/qualite-eau-card.js"

# Fuseau horaire des dates de prélèvement selon la région.
REGION_TZ = {
    "01": "America/Guadeloupe",
    "02": "America/Martinique",
    "03": "America/Cayenne",
    "04": "Indian/Reunion",
    "06": "Indian/Mayotte",
}
DEFAULT_TZ = "Europe/Paris"
