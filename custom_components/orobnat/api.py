"""Client pour le site Orobnat (contrôle sanitaire des eaux, ministère de la Santé).

Le site n'a pas d'API : c'est une application web à session. Il faut ouvrir la
page de la région, puis rejouer les étapes du formulaire (département, commune,
réseau, recherche) dans la même session HTTP, sinon le serveur renvoie vers
sante.gouv.fr ou répond en erreur 500.

Ce module est synchrone (requests) : Home Assistant l'appelle dans un thread
via hass.async_add_executor_job.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from html.parser import HTMLParser

import requests

BASE_URL = "https://orobnat.sante.gouv.fr/orobnat"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
TIMEOUT = 30
ENCODING = "ISO-8859-1"

# Codes INSEE des régions, acceptés par le paramètre idRegion du site.
REGIONS: dict[str, str] = {
    "84": "Auvergne-Rhône-Alpes",
    "27": "Bourgogne-Franche-Comté",
    "53": "Bretagne",
    "24": "Centre-Val de Loire",
    "94": "Corse",
    "44": "Grand Est",
    "01": "Guadeloupe",
    "03": "Guyane",
    "32": "Hauts-de-France",
    "11": "Île-de-France",
    "04": "La Réunion",
    "02": "Martinique",
    "06": "Mayotte",
    "28": "Normandie",
    "75": "Nouvelle-Aquitaine",
    "76": "Occitanie",
    "52": "Pays de la Loire",
    "93": "Provence-Alpes-Côte d'Azur",
}


class OrobnatError(Exception):
    """Erreur de communication avec le site ou réponse inattendue."""


@dataclass
class Analyse:
    """Une ligne du tableau « Résultats d'analyses »."""

    parametre: str
    valeur: str
    limite: str = ""
    reference: str = ""


@dataclass
class Bulletin:
    """Le dernier bulletin publié pour un réseau."""

    infos: dict[str, str] = field(default_factory=dict)
    analyses: list[Analyse] = field(default_factory=list)
    # rang du bulletin (0 = le plus récent du réseau) et, si la commune était demandée, s'il en vient
    position: int = 0
    commune_trouvee: bool | None = None

    @property
    def date_prelevement(self) -> datetime | None:
        raw = self.infos.get("Date du prélèvement", "")
        m = re.search(r"(\d{2})/(\d{2})/(\d{4})\s+(\d{1,2})h(\d{2})", raw)
        if not m:
            m2 = re.search(r"(\d{2})/(\d{2})/(\d{4})", raw)
            if not m2:
                return None
            d, mo, y = m2.groups()
            return datetime(int(y), int(mo), int(d))
        d, mo, y, h, mi = m.groups()
        return datetime(int(y), int(mo), int(d), int(h), int(mi))


class _PageParser(HTMLParser):
    """Récupère les listes déroulantes et les lignes de tableaux de la page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.selects: dict[str, list[tuple[str, str]]] = {}
        self.tables: list[list[list[str]]] = []
        self._select: str | None = None
        self._option: str | None = None
        self._option_text: list[str] = []
        self._table_stack: list[list[list[str]]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "select":
            self._select = a.get("name") or ""
            self.selects.setdefault(self._select, [])
        elif tag == "option" and self._select is not None:
            self._option = a.get("value") or ""
            self._option_text = []
        elif tag == "table":
            self._table_stack.append([])
        elif tag == "tr" and self._table_stack:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag):
        if tag == "option" and self._option is not None and self._select is not None:
            text = " ".join("".join(self._option_text).split())
            self.selects[self._select].append((self._option, text))
            self._option = None
        elif tag == "select":
            self._select = None
        elif tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._row and self._table_stack:
                self._table_stack[-1].append(self._row)
            self._row = None
        elif tag == "table" and self._table_stack:
            self.tables.append(self._table_stack.pop())

    def handle_data(self, data):
        if self._option is not None:
            self._option_text.append(data)
        if self._cell is not None:
            self._cell.append(data)


def _parse(html: str) -> _PageParser:
    p = _PageParser()
    p.feed(html)
    p.close()
    return p


def same_commune(a: str, b: str) -> bool:
    """Même commune malgré accents, casse, tirets et « Saint » / « St » (« ST-JEAN » = « Saint-Jean »)."""
    def norm(s: str) -> str:
        s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().upper()
        s = re.sub(r"[^A-Z0-9]+", " ", s)
        s = re.sub(r"\bSAINTE\b", "STE", s)
        s = re.sub(r"\bSAINT\b", "ST", s)
        return " ".join(s.split())
    return bool(norm(a)) and norm(a) == norm(b)


def _clean_label(label: str) -> str:
    # « Lieu de prélèvement (1) » -> « Lieu de prélèvement »
    return re.sub(r"\s*\(\d\)\s*$", "", label).strip()


def parse_bulletin(html: str) -> Bulletin:
    page = _parse(html)
    bulletin = Bulletin()
    for table in page.tables:
        if table and table[0][:2] == ["Paramètre", "Valeur"]:
            for row in table[1:]:
                if len(row) >= 2 and row[0]:
                    row = row + [""] * (4 - len(row))
                    bulletin.analyses.append(Analyse(*row[:4]))
        else:
            for row in table:
                if len(row) == 2 and row[0]:
                    bulletin.infos[_clean_label(row[0])] = row[1]
    return bulletin


class OrobnatClient:
    """Une instance = une session. Créer un nouveau client pour chaque recherche."""

    def __init__(self, region: str) -> None:
        self.region = region
        self._session = requests.Session()
        self._session.headers["User-Agent"] = USER_AGENT
        self._form: dict[str, str] = {
            "idRegion": region,
            "usd": "AEP",
            "posPLV": "0",
            "methode": "",
        }
        self._page: _PageParser | None = None

    def close(self) -> None:
        self._session.close()

    def __enter__(self) -> "OrobnatClient":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def _decode(self, resp: requests.Response) -> str:
        if resp.status_code != 200:
            raise OrobnatError(f"HTTP {resp.status_code} sur {resp.url}")
        if "orobnat" not in resp.url:
            raise OrobnatError(f"Redirigé hors d'Orobnat ({resp.url}) : session perdue")
        resp.encoding = ENCODING
        return resp.text

    def _open(self) -> None:
        try:
            resp = self._session.get(
                f"{BASE_URL}/afficherPage.do",
                params={"methode": "menu", "usd": "AEP", "idRegion": self.region},
                timeout=TIMEOUT,
            )
        except requests.RequestException as err:
            raise OrobnatError(str(err)) from err
        self._page = _parse(self._decode(resp))

    def _post(self, methode: str, **fields: str) -> None:
        if self._page is None:
            self._open()
        self._form.update(fields)
        self._form["methode"] = methode
        try:
            resp = self._session.post(
                f"{BASE_URL}/rechercherResultatQualite.do",
                data=self._form,
                timeout=TIMEOUT,
            )
        except requests.RequestException as err:
            raise OrobnatError(str(err)) from err
        html = self._decode(resp)
        self._page = _parse(html)
        self._last_html = html

    def _options(self, name: str) -> list[tuple[str, str]]:
        assert self._page is not None
        return list(self._page.selects.get(name, []))

    # --- listes pour l'assistant de configuration --------------------------

    def departements(self) -> list[tuple[str, str]]:
        self._open()
        return self._options("departement")

    def communes(self, departement: str) -> list[tuple[str, str]]:
        self._post("changerDepartement", departement=departement, communeDepartement="", reseau="")
        return self._options("communeDepartement")

    def reseaux(self, departement: str, commune: str) -> list[tuple[str, str]]:
        self._post("changerDepartement", departement=departement, communeDepartement="", reseau="")
        self._post("changerCommune", departement=departement, communeDepartement=commune, reseau="")
        return self._options("reseau")

    # --- bulletin ----------------------------------------------------------

    def bulletin(
        self,
        departement: str,
        commune: str,
        reseau: str,
        commune_nom: str | None = None,
        max_bulletins: int = 0,
        max_age_days: int = 730,
    ) -> Bulletin:
        """Dernier bulletin du réseau. Avec commune_nom : le plus récent prélevé dans cette commune, en
        remontant au plus max_bulletins bulletins précédents (bouton « Bulletin précédent » : posPLV + 1) et
        pas plus vieux que max_age_days ; à défaut, le dernier bulletin du réseau (commune_trouvee = False)."""
        self._post("changerDepartement", departement=departement, communeDepartement="", reseau="")
        self._post("changerCommune", departement=departement, communeDepartement=commune, reseau="")
        if reseau not in {v for v, _ in self._options("reseau")}:
            raise OrobnatError(f"Réseau {reseau} introuvable pour la commune {commune}")
        self._post("changerReseau", departement=departement, communeDepartement=commune, reseau=reseau)
        self._post("rechercher", departement=departement, communeDepartement=commune, reseau=reseau, posPLV="0")
        latest = parse_bulletin(self._last_html)
        if not commune_nom:
            return latest
        if same_commune(latest.infos.get("Commune de prélèvement", ""), commune_nom):
            latest.commune_trouvee = True
            return latest
        oldest = (latest.date_prelevement or datetime.now()) - timedelta(days=max_age_days)
        for pos in range(1, max_bulletins + 1):
            self._post("rechercher", departement=departement, communeDepartement=commune, reseau=reseau, posPLV=str(pos))
            older = parse_bulletin(self._last_html)
            date = older.date_prelevement
            if not older.infos or (date is not None and date < oldest):
                break
            if same_commune(older.infos.get("Commune de prélèvement", ""), commune_nom):
                older.position = pos
                older.commune_trouvee = True
                return older
        latest.commune_trouvee = False
        return latest


# --- conversion des valeurs ------------------------------------------------

_NUM_RE = re.compile(r"^\s*([<>≤≥]?)\s*(-?\d+(?:[.,]\d+)?)\s*(.*)$")


def parse_valeur(raw: str) -> tuple[float | None, str | None, str]:
    """« 3,90 mg/L » -> (3.9, "mg/L", "") ; « <0,1 NFU » -> (0.0, "NFU", "<").

    Une valeur « < seuil » (sous la limite de quantification) est ramenée à 0,
    pour que les graphiques ne montrent pas une fausse présence. Le texte brut
    reste disponible en attribut.
    """
    m = _NUM_RE.match(raw or "")
    if not m:
        return None, None, ""
    signe, nombre, unite = m.groups()
    valeur = float(nombre.replace(",", "."))
    if signe == "<":
        valeur = 0.0
    unite = unite.strip() or None
    if unite == "unité pH":
        unite = None
    return valeur, unite, signe
