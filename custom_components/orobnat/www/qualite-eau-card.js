/*
 * Carte « Qualité de l'eau » pour l'intégration Orobnat.
 *
 *   type: custom:qualite-eau-card
 *   entity: sensor.eau_lyon_bulletin
 *   # facultatif :
 *   title: Eau du robinet
 *   parametres: [Nitrates, Chlore libre, pH, Titre hydrotimétrique]  # filtre (début du nom)
 *   conclusions: true
 *   replier: true      # résultats d'analyses repliés, à déplier d'un clic
 */
const CARD_VERSION = "1.3.0";

const num = (s) => {
  const m = String(s ?? "").match(/-?\d+(?:[.,]\d+)?/);
  return m ? parseFloat(m[0].replace(",", ".")) : null;
};

// « ≥6,5 et ≤ 9 unité pH » -> {min: 6.5, max: 9}
const bornes = (s) => {
  const txt = String(s ?? "");
  const min = txt.match(/≥\s*(\d+(?:[.,]\d+)?)/);
  const max = txt.match(/≤\s*(\d+(?:[.,]\d+)?)/);
  const r = {
    min: min ? parseFloat(min[1].replace(",", ".")) : null,
    max: max ? parseFloat(max[1].replace(",", ".")) : null,
  };
  return r.min === null && r.max === null ? null : r;
};

const hors = (v, b) => b && v !== null && ((b.min !== null && v < b.min) || (b.max !== null && v > b.max));

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const propre = (s) => (/\d/.test(String(s ?? "")) ? String(s) : "");

class QualiteEauCard extends HTMLElement {
  static getStubConfig(hass) {
    const e = Object.keys(hass.states).find(
      (id) => id.startsWith("sensor.") && Array.isArray(hass.states[id].attributes.analyses)
    );
    return { entity: e || "sensor.eau_bulletin" };
  }

  static getConfigForm() {
    return {
      schema: [
        { name: "entity", required: true, selector: { entity: { domain: "sensor", integration: "orobnat" } } },
        { name: "title", selector: { text: {} } },
        { name: "conclusions", selector: { boolean: {} } },
        { name: "replier", selector: { boolean: {} } },
      ],
      computeLabel: (s) =>
        ({
          entity: "Capteur « Bulletin »",
          title: "Titre (facultatif)",
          conclusions: "Afficher les conclusions sanitaires",
          replier: "Replier les résultats d'analyses (à déplier d'un clic)",
        })[
          s.name
        ],
    };
  }

  setConfig(config) {
    if (!config.entity) throw new Error("Indiquez « entity » : le capteur Bulletin de l'intégration Orobnat");
    this._config = { conclusions: true, replier: false, ...config };
    this._ouvert = false; // résultats dépliés (option « replier »), gardé entre deux mises à jour
    this._last = null;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener(
        "toggle",
        (ev) => {
          if (ev.target.matches?.("details.resultats")) this._ouvert = ev.target.open;
        },
        true
      );
      this.shadowRoot.addEventListener("click", (ev) => {
        if (ev.target.closest?.("a.source")) ouvrirBulletin(ev, this._last?.attributes || {});
      });
    }
  }

  getCardSize() {
    return 6;
  }

  set hass(hass) {
    const st = hass.states[this._config.entity];
    if (st === this._last) return;
    this._last = st;
    this._render(st);
  }

  _render(st) {
    const root = this.shadowRoot;
    if (!st) {
      root.innerHTML = `<ha-card><div class="msg">Entité introuvable : ${esc(this._config.entity)}</div></ha-card>${STYLE}`;
      return;
    }
    const a = st.attributes;
    const conforme = st.state === "Conforme";
    const inconnu = !["Conforme", "Non conforme"].includes(st.state);

    let date = "";
    let age = "";
    if (a.date_prelevement) {
      const d = new Date(a.date_prelevement);
      date = d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
      const jours = Math.floor((Date.now() - d.getTime()) / 86400000);
      age = jours <= 0 ? "aujourd'hui" : jours === 1 ? "hier" : `il y a ${jours} jours`;
    }

    let analyses = Array.isArray(a.analyses) ? a.analyses : [];
    const filtre = this._config.parametres;
    if (Array.isArray(filtre) && filtre.length) {
      const f = filtre.map((x) => String(x).toLowerCase());
      analyses = analyses.filter((r) => f.some((x) => r.parametre.toLowerCase().startsWith(x)));
    }

    const alertes = { bad: 0, warn: 0 };
    const lignes = analyses
      .map((r) => {
        const v = String(r.valeur).trim().startsWith("<") ? 0 : num(r.valeur);
        const lim = bornes(r.limite);
        const ref = bornes(r.reference);
        let etat = "ok";
        let info = "";
        if (hors(v, lim)) {
          etat = "bad";
          info = "Limite de qualité dépassée";
        } else if (hors(v, ref)) {
          etat = "warn";
          info = "Référence de qualité non respectée";
        } else if (v === null) {
          etat = "na";
        }
        if (etat in alertes) alertes[etat] += 1;
        // « ≥ et ≤ 25 °C » (pas de minimum publié) -> « ≤ 25 °C »
        const seuil = (propre(r.limite) || propre(r.reference)).replace(/≥\s*et\s+/, "").trim();
        return `<tr title="${esc(info)}">
          <td><span class="dot ${etat}"></span>${esc(r.parametre.replace(/\s*\*$/, ""))}</td>
          <td class="val">${esc(r.valeur)}</td>
          <td class="seuil">${esc(seuil)}</td>
        </tr>`;
      })
      .join("");

    const tableau = `<table><thead><tr><th>Paramètre</th><th>Valeur</th><th>Seuil</th></tr></thead><tbody>${lignes}</tbody></table>`;
    const titre = this._config.title || `Eau du robinet – ${a.commune ? a.commune : ""}`;
    // Nom du réseau seulement s'il apporte une information (≠ nom de la commune).
    const norm = (s) => String(s ?? "").normalize("NFD").replace(/[^a-z0-9]/gi, "").toLowerCase();
    const sousTitre = a.reseau && norm(a.reseau) !== norm(a.commune) ? a.reseau : "";
    root.innerHTML = `
      <ha-card>
        <div class="head">
          <div>
            <div class="titre">${esc(titre)}</div>
            ${sousTitre ? `<div class="sous">${esc(sousTitre)}</div>` : ""}
          </div>
          <div class="badge ${inconnu ? "na" : conforme ? "ok" : "bad"}">
            <ha-icon icon="${conforme ? "mdi:water-check" : "mdi:water-alert"}"></ha-icon>
            ${esc(inconnu ? "Indisponible" : st.state)}
          </div>
        </div>
        ${date ? `<div class="date">Prélèvement du ${esc(date)} <span>(${esc(age)})</span></div>` : ""}
        ${this._config.conclusions && a.conclusions ? `<div class="concl">${esc(a.conclusions)}</div>` : ""}
        <div class="flags">
          ${flag("Bactériologie", a.conformite_bacteriologique)}
          ${flag("Physico-chimie", a.conformite_physico_chimique)}
          ${flag("Références", a.respect_references_qualite)}
        </div>
        ${lignes ? (this._config.replier ? replie(tableau, analyses.length, alertes, this._ouvert) : tableau) : `<div class="msg">Aucune analyse dans le dernier bulletin.</div>`}
        <div class="src"><a class="source" href="${esc(a.source || "https://orobnat.sante.gouv.fr")}" target="_blank" rel="noreferrer">Source : ministère de la Santé / ARS</a></div>
      </ha-card>${STYLE}`;
  }
}

// Orobnat ne sert un bulletin qu'à un navigateur qui a déjà ouvert la page de la région (session) : sans elle,
// l'adresse du bulletin répond en erreur 500. On ouvre donc la page de la région, puis on fait passer le même
// onglet par le département et la commune (pour que le formulaire du site montre la bonne commune et le bon
// réseau) et enfin par le bulletin. Sans « source_bulletin » (ancienne version de l'intégration) ou en clic avec
// modificateur : simple lien vers la page de la région.
const ETAPE_MS = 1200;
const ouvrirBulletin = (ev, a) => {
  if (!a.source || !a.source_bulletin || ev.button || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
  ev.preventDefault();
  const w = window.open(a.source, "_blank");
  if (!w) return; // application mobile : la page de la région s'ouvre dans le navigateur
  const etape = (methode) => {
    const u = new URL(a.source_bulletin);
    u.searchParams.set("methode", methode);
    return u.href;
  };
  const etapes = [etape("changerDepartement"), etape("changerCommune"), a.source_bulletin];
  const suivante = () => {
    const url = etapes.shift();
    if (!url) return;
    try {
      if (w.closed) return;
      w.location.href = url;
    } catch (e) {
      return; // onglet fermé ou inaccessible : on garde la page affichée
    }
    setTimeout(suivante, ETAPE_MS);
  };
  setTimeout(suivante, ETAPE_MS);
};

// Option « replier » : le tableau derrière un résumé cliquable (« 12 résultats d'analyses · 1 hors limite »)
const replie = (tableau, n, alertes, ouvert) => {
  const details = [
    alertes.bad ? `<span class="bad">${alertes.bad} hors limite${alertes.bad > 1 ? "s" : ""}</span>` : "",
    alertes.warn ? `<span class="warn">${alertes.warn} hors référence${alertes.warn > 1 ? "s" : ""}</span>` : "",
  ].filter(Boolean);
  return `<details class="resultats"${ouvert ? " open" : ""}>
    <summary><ha-icon icon="mdi:chevron-down"></ha-icon>${n} résultat${n > 1 ? "s" : ""} d'analyses${details.length ? " · " + details.join(" · ") : ""}</summary>
    ${tableau}
  </details>`;
};

const flag = (label, v) => {
  if (!v) return "";
  const ok = String(v).toLowerCase() === "oui";
  return `<span class="flag ${ok ? "ok" : "bad"}"><ha-icon icon="${ok ? "mdi:check-circle" : "mdi:alert-circle"}"></ha-icon>${esc(label)}</span>`;
};

const STYLE = `<style>
  ha-card { padding: 16px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .titre { font-size: 1.25em; font-weight: 500; color: var(--primary-text-color); }
  .sous, .date span, .src, .seuil { color: var(--secondary-text-color); }
  .sous { font-size: .85em; }
  .badge { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 16px;
           font-weight: 500; white-space: nowrap; color: #fff; }
  .badge ha-icon { --mdc-icon-size: 18px; }
  .badge.ok { background: var(--success-color, #43a047); }
  .badge.bad { background: var(--error-color, #db4437); }
  .badge.na { background: var(--disabled-color, #9e9e9e); }
  .date { margin-top: 10px; }
  .concl { margin-top: 8px; font-size: .9em; color: var(--primary-text-color); }
  .flags { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 10px 0 6px; font-size: .9em; }
  .flag { display: inline-flex; align-items: center; gap: 4px; }
  .flag ha-icon { --mdc-icon-size: 18px; }
  .flag.ok ha-icon { color: var(--success-color, #43a047); }
  .flag.bad ha-icon { color: var(--error-color, #db4437); }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: .9em; }
  th { text-align: left; font-weight: 500; color: var(--secondary-text-color);
       border-bottom: 1px solid var(--divider-color); padding: 4px 6px 4px 0; }
  td { padding: 5px 6px 5px 0; border-bottom: 1px solid var(--divider-color); vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .val { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .seuil { font-size: .9em; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; vertical-align: middle; }
  .dot.ok { background: var(--success-color, #43a047); }
  .dot.warn { background: var(--warning-color, #ffa600); }
  .dot.bad { background: var(--error-color, #db4437); }
  .dot.na { background: var(--disabled-color, #bdbdbd); }
  .src { margin-top: 10px; font-size: .8em; }
  .src a { color: inherit; }
  .msg { padding: 8px 0; color: var(--secondary-text-color); }
  details.resultats { margin-top: 8px; }
  details.resultats summary { display: flex; align-items: center; gap: 4px; cursor: pointer; list-style: none;
                              padding: 6px 0; font-size: .9em; color: var(--secondary-text-color); user-select: none; }
  details.resultats summary::-webkit-details-marker { display: none; }
  details.resultats summary ha-icon { --mdc-icon-size: 20px; transition: transform .2s; }
  details.resultats[open] summary ha-icon { transform: rotate(180deg); }
  details.resultats summary .bad { color: var(--error-color, #db4437); font-weight: 500; }
  details.resultats summary .warn { color: var(--warning-color, #ffa600); font-weight: 500; }
  details.resultats table { margin-top: 0; }
</style>`;

/* ======================================================================================================
 * Carte « Qualité de l'eau · Panneau » : même capteur Bulletin, présentation dans le style des cartes
 * MyElectricalData (content-card-linky-new) : en-tête, bloc principal, tuiles par paramètre, historique.
 *
 *   type: custom:qualite-eau-panneau-card
 *   entity: sensor.eau_lyon_bulletin
 *   # facultatif :
 *   title: Eau du robinet
 *   theme: v2            # v2 (bleu nuit) | auto (clair si Home Assistant est en mode clair) | ha (thème HA)
 *   parametres: [Nitrates, Chlore libre, pH, Titre hydrotimétrique]   # tuiles (début du nom)
 *   historique: 12       # prélèvements dans le graphique (0 : pas de graphique)
 *   conclusions: true
 *   liste: true          # tous les résultats, repliés sous une ligne
 *   font_size: 100       # taille du texte, de 70 à 150 %
 * ==================================================================================================== */

const PANNEAU_DEFAUTS = {
  title: "",
  theme: "v2",
  parametres: ["Nitrates", "Chlore libre", "pH", "Titre hydrotimétrique"],
  historique: 12,
  conclusions: true,
  liste: true,
  font_size: 100,
};

const sansAccent = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Nom court d'un paramètre pour les tuiles
const NOMS_COURTS = [
  ["titre hydrotimetrique", "Dureté"],
  ["nitrates", "Nitrates"],
  ["nitrites", "Nitrites"],
  ["chlore libre", "Chlore libre"],
  ["chlore total", "Chlore total"],
  ["ph", "pH"],
  ["turbidite", "Turbidité"],
  ["conductivite", "Conductivité"],
  ["temperature", "Température"],
  ["escherichia", "E. coli"],
  ["enterocoques", "Entérocoques"],
];
const nomCourt = (p) => {
  const n = sansAccent(p);
  const hit = NOMS_COURTS.find(([k]) => n === k || n.startsWith(k + " "));
  return hit ? hit[1] : String(p).replace(/\s*\*$/, "").replace(/\s*\(.*\)\s*$/, "").trim();
};

// « 62 mg/L » -> {v: 62, unite: "mg/L", inf: false} ; « <0,1 NFU » -> {v: 0, unite: "NFU", inf: true}
const lireValeur = (raw) => {
  const m = String(raw ?? "").match(/^\s*([<>≤≥]?)\s*(-?\d+(?:[.,]\d+)?)\s*(.*)$/);
  if (!m) return { v: null, unite: "", inf: false, texte: String(raw ?? "") };
  const inf = m[1] === "<";
  return { v: inf ? 0 : parseFloat(m[2].replace(",", ".")), unite: m[3].replace(/^unité pH$/, "").trim(), inf, brut: m[2] };
};

// État d'une analyse : ok, warn (référence de qualité), bad (limite de qualité), na (pas de valeur numérique)
const etatAnalyse = (valeur, limite, reference) => {
  const { v } = lireValeur(valeur);
  if (hors(v, bornes(limite))) return "bad";
  if (hors(v, bornes(reference))) return "warn";
  return v === null ? "na" : "ok";
};

const seuilTexte = (limite, reference) => (propre(limite) || propre(reference)).replace(/≥\s*et\s+/, "").trim();

const fr = (v, dec) =>
  v === null || v === undefined || Number.isNaN(v)
    ? "—"
    : Number(v).toLocaleString("fr-FR", { minimumFractionDigits: dec ?? 0, maximumFractionDigits: dec ?? 2 });

const decimales = (brut) => {
  const m = String(brut ?? "").match(/[.,](\d+)/);
  return m ? m[1].length : 0;
};

// Valeur d'un point d'historique telle que publiée (« < 0,1 », « 12,5 »)
const valeurTexte = (p) => {
  const l = lireValeur(p.brut);
  return l.v === null ? esc(fr(p.v)) : `${l.inf ? "&lt; " : ""}${esc(l.brut)}`;
};

const dateLongue = (d) => d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const dateCourte = (d) => d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
const ilYa = (d) => {
  const j = Math.floor((Date.now() - d.getTime()) / 86400000);
  return j <= 0 ? "aujourd'hui" : j === 1 ? "hier" : `il y a ${j} jours`;
};

// Dureté (titre hydrotimétrique, °f) : classes usuelles
const durete = (v) => (v === null ? "" : v < 15 ? "eau douce" : v < 25 ? "eau moyennement dure" : v < 35 ? "eau dure" : "eau très dure");

class QualiteEauPanneauCard extends HTMLElement {
  static getStubConfig(hass) {
    return { entity: QualiteEauCard.getStubConfig(hass).entity };
  }

  static getConfigForm() {
    const options = ["Nitrates", "Nitrites", "Chlore libre", "Chlore total", "pH", "Titre hydrotimétrique", "Turbidité", "Conductivité", "Température"];
    return {
      schema: [
        { name: "entity", required: true, selector: { entity: { domain: "sensor", integration: "orobnat" } } },
        { name: "title", selector: { text: {} } },
        {
          name: "theme",
          selector: {
            select: {
              mode: "dropdown",
              options: [
                { value: "v2", label: "Bleu nuit (style MyElectricalData)" },
                { value: "auto", label: "Bleu nuit ou clair, selon Home Assistant" },
                { value: "ha", label: "Couleurs du thème Home Assistant" },
              ],
            },
          },
        },
        { name: "parametres", selector: { select: { multiple: true, custom_value: true, options } } },
        { name: "historique", selector: { number: { min: 0, max: 40, step: 1, mode: "slider" } } },
        { name: "conclusions", selector: { boolean: {} } },
        { name: "liste", selector: { boolean: {} } },
        { name: "font_size", selector: { number: { min: 70, max: 150, step: 5, unit_of_measurement: "%", mode: "slider" } } },
      ],
      computeLabel: (s) =>
        ({
          entity: "Capteur « Bulletin »",
          title: "Titre (facultatif)",
          theme: "Couleurs de la carte",
          parametres: "Tuiles (paramètres, dans l'ordre)",
          historique: "Prélèvements dans le graphique (0 : masqué)",
          conclusions: "Afficher les conclusions sanitaires",
          liste: "Afficher tous les résultats (repliés)",
          font_size: "Taille du texte",
        })[s.name],
    };
  }

  setConfig(config) {
    if (!config.entity) throw new Error("Indiquez « entity » : le capteur Bulletin de l'intégration Orobnat");
    this._config = { ...PANNEAU_DEFAUTS, ...config };
    this._sig = null;
    this._choix = null; // paramètre affiché dans le graphique
    this._point = null; // prélèvement sélectionné dans le graphique
    this._liste = false; // liste des résultats dépliée
    this._histo = {}; // entity_id -> [{t: Date, v, brut}]
    this._histoSig = null;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (ev) => this._clic(ev));
      this.shadowRoot.addEventListener(
        "toggle",
        (ev) => {
          if (ev.target.matches?.("details.tout")) this._liste = ev.target.open;
        },
        true
      );
    }
    if (this._hass) this._render();
  }

  getCardSize() {
    return 9;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  set hass(hass) {
    this._hass = hass;
    const st = hass.states[this._config.entity];
    const sig = `${this._config.theme}|${hass.themes?.darkMode}|${st?.last_updated || "-"}|${this._tuiles()
      .map((t) => t.entity_id && hass.states[t.entity_id]?.last_updated)
      .join("|")}`;
    if (sig === this._sig) return;
    this._sig = sig;
    this._render();
    this._chargerHistorique();
  }

  /* ---------------------------------------------------------------- données */

  // Capteurs « paramètre » de l'appareil du bulletin : [{entity_id, nom, st}]
  _capteurs() {
    const h = this._hass;
    const dev = h?.entities?.[this._config.entity]?.device_id;
    if (!dev) return [];
    return Object.values(h.entities)
      .filter((e) => e.device_id === dev && e.entity_id !== this._config.entity && e.entity_id.startsWith("sensor."))
      .map((e) => ({ entity_id: e.entity_id, st: h.states[e.entity_id] }))
      .filter((e) => e.st && "valeur_brute" in e.st.attributes);
  }

  // Tuiles demandées : le bulletin en priorité, sinon la dernière valeur connue (capteur du paramètre)
  _tuiles() {
    const st = this._hass?.states[this._config.entity];
    if (!st) return [];
    const analyses = Array.isArray(st.attributes.analyses) ? st.attributes.analyses : [];
    const capteurs = this._capteurs();
    const demandes = Array.isArray(this._config.parametres) ? this._config.parametres : [];
    const out = [];
    for (const d of demandes) {
      const k = sansAccent(d);
      if (!k) continue;
      // mots entiers (« ph » ne doit pas trouver « phosphore ») ; parmi plusieurs, le nom le plus court
      // (« Nitrates » : « Nitrates (en NO3) » plutôt que « Nitrates/50 + Nitrites/3 »)
      const court = (liste, nom) =>
        liste.reduce((best, x) => (best === undefined || sansAccent(nom(x)).length < sansAccent(nom(best)).length ? x : best), undefined);
      const capteur = court(
        capteurs.filter((c) => ` ${sansAccent(c.st.attributes.friendly_name)} `.includes(` ${k} `)),
        (c) => c.st.attributes.friendly_name
      );
      const a = court(
        analyses.filter((r) => ` ${sansAccent(r.parametre)} `.startsWith(` ${k} `)),
        (r) => r.parametre
      );
      if (!a && !capteur) continue;
      const attrs = capteur?.st.attributes || {};
      const parametre = a?.parametre || String(attrs.friendly_name || d);
      if (out.some((t) => t.parametre === parametre)) continue;
      out.push({
        parametre,
        nom: nomCourt(a?.parametre || d),
        valeur: a?.valeur ?? attrs.valeur_brute,
        limite: a?.limite ?? attrs.limite_qualite ?? "",
        reference: a?.reference ?? attrs.reference_qualite ?? "",
        date: a ? null : attrs.date_prelevement, // mesuré lors d'un prélèvement précédent
        entity_id: capteur?.entity_id || null,
      });
    }
    return out;
  }

  async _chargerHistorique() {
    const c = this._config;
    if (!this._hass?.callWS || !(c.historique > 0)) return;
    const ids = this._tuiles()
      .map((t) => t.entity_id)
      .filter(Boolean);
    const sig = ids.join(",") + "|" + (this._hass.states[c.entity]?.attributes.date_prelevement || "");
    if (!ids.length || sig === this._histoSig) return;
    this._histoSig = sig;
    try {
      const debut = new Date(Date.now() - 2 * 365 * 86400000).toISOString();
      const res = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: debut,
        entity_ids: ids,
        minimal_response: false,
        no_attributes: false,
        significant_changes_only: false,
      });
      const histo = {};
      for (const id of ids) {
        // un point par prélèvement (date_prelevement), quelle que soit la date d'enregistrement
        const parDate = new Map();
        let attrs = {};
        for (const p of res?.[id] || []) {
          if (p.a) attrs = { ...attrs, ...p.a };
          const v = parseFloat(p.s);
          if (Number.isNaN(v)) continue;
          const t = attrs.date_prelevement ? new Date(attrs.date_prelevement) : new Date((p.lu || 0) * 1000);
          if (Number.isNaN(t.getTime())) continue;
          parDate.set(t.toISOString().slice(0, 10), { t, v, brut: attrs.valeur_brute });
        }
        histo[id] = [...parDate.values()].sort((x, y) => x.t - y.t);
      }
      this._histo = histo;
    } catch (e) {
      this._histo = {};
    }
    this._render();
  }

  /* ---------------------------------------------------------------- actions */

  _clic(ev) {
    const t = ev.target.closest?.("[data-tuile],[data-point],a.source");
    if (!t) return;
    if (t.matches("a.source")) return ouvrirBulletin(ev, this._hass?.states[this._config.entity]?.attributes || {});
    if (t.dataset.tuile !== undefined) {
      this._choix = t.dataset.tuile;
      this._point = null;
    } else {
      this._point = Number(t.dataset.point);
    }
    this._render();
  }

  /* ---------------------------------------------------------------- rendu */

  _render() {
    const c = this._config;
    const root = this.shadowRoot;
    if (!root || !this._hass) return;
    const theme = themeClassEau(c.theme, this._hass);
    const fs = Math.min(150, Math.max(70, Number(c.font_size) || 100)) / 100;
    const st = this._hass.states[c.entity];
    if (!st) {
      root.innerHTML = `${PANNEAU_STYLE}<ha-card class="${theme}" style="--fs:${fs}"><div class="vide">Entité introuvable : ${esc(c.entity)}</div></ha-card>`;
      return;
    }
    const a = st.attributes;
    const analyses = Array.isArray(a.analyses) ? a.analyses : [];
    const compte = { ok: 0, warn: 0, bad: 0, na: 0 };
    const lignes = analyses.map((r) => {
      const e = etatAnalyse(r.valeur, r.limite, r.reference);
      compte[e] += 1;
      return { ...r, etat: e };
    });
    const tuiles = this._tuiles();
    if (!this._choix || !tuiles.some((t) => t.parametre === this._choix)) this._choix = tuiles.find((t) => t.entity_id)?.parametre || null;

    root.innerHTML = `${PANNEAU_STYLE}<ha-card class="${theme}" style="--fs:${fs}">
      ${this._entete(a)}
      ${this._principal(st, a, compte)}
      ${tuiles.length ? `<div class="tuiles${tuiles.length === 3 ? " trois" : ""}">${tuiles.map((t) => this._tuile(t)).join("")}</div>` : ""}
      ${this._graphique(tuiles)}
      ${c.conclusions && a.conclusions ? `<div class="concl"><div class="tuile-l">Conclusions sanitaires</div>${esc(a.conclusions)}</div>` : ""}
      ${c.liste && lignes.length ? this._liste_html(lignes) : ""}
      <footer>
        <a class="source" href="${esc(a.source || "https://orobnat.sante.gouv.fr")}" target="_blank" rel="noreferrer">Source : ministère de la Santé / ARS</a>
        ${a.distributeur ? `<span>${esc(a.distributeur)}</span>` : ""}
      </footer>
    </ha-card>`;
  }

  _entete(a) {
    const titre = this._config.title || "Eau du robinet";
    const norm = (s) => sansAccent(s).replace(/ /g, "");
    const reseau = a.reseau && norm(a.reseau) !== norm(a.commune) ? a.reseau : "";
    const sous = [a.commune, reseau].filter(Boolean).map(esc).join(" · ");
    const pastille = (label, v) => {
      if (!v) return "";
      const l = String(v).toLowerCase();
      const cls = l === "oui" ? "p-ok" : l === "non" ? "p-bad" : "p-na";
      const txt = l === "oui" ? "conforme" : l === "non" ? "non conforme" : esc(v);
      return `<div class="pill ${cls}"><span class="dot"></span><span class="pill-l">${label}</span><span class="pill-v">${txt}</span></div>`;
    };
    return `<header>
      <div class="brand">
        <svg viewBox="0 0 32 32" aria-hidden="true"><path class="house" d="M4 14.5 16 4l12 10.5V27a1.5 1.5 0 0 1-1.5 1.5h-5M10.5 28.5h-5A1.5 1.5 0 0 1 4 27V14.5"/><path class="drop" d="M16 10.5c-2.6 3.4-5 6.3-5 9a5 5 0 0 0 10 0c0-2.7-2.4-5.6-5-9z"/><path class="glint" d="M13.6 20.2a2.6 2.6 0 0 0 2.2 2.4"/></svg>
        <div><div class="title">${esc(titre)}</div>${sous ? `<div class="sub">${sous}</div>` : ""}</div>
      </div>
      <div class="pills">${pastille("Bactériologie", a.conformite_bacteriologique)}${pastille("Physico-chimie", a.conformite_physico_chimique)}</div>
    </header>`;
  }

  _principal(st, a, n) {
    const etat = st.state === "Conforme" ? "ok" : st.state === "Non conforme" ? "bad" : "na";
    const d = a.date_prelevement ? new Date(a.date_prelevement) : null;
    const total = n.ok + n.warn + n.bad + n.na;
    const ailleurs =
      a.commune_prelevement && a.commune && sansAccent(a.commune_prelevement) !== sansAccent(a.commune)
        ? `<div class="evo">Prélevé à ${esc(a.commune_prelevement)}, sur le même réseau</div>`
        : "";
    const ref = a.respect_references_qualite ? String(a.respect_references_qualite).toLowerCase() : "";
    const part = (k) => (total ? (100 * n[k]) / total : 0);
    return `<div class="hero">
      <div>
        <div class="hero-l">${d ? `Prélèvement du ${esc(dateLongue(d))} · ${esc(ilYa(d))}` : "Dernier bulletin"}</div>
        <div class="hero-v ${etat}">${esc(etat === "na" ? "Indisponible" : st.state)}</div>
        ${ailleurs}
      </div>
      <div class="hero-r">
        <div class="big">${total}</div>
        <div class="hero-p">paramètre${total > 1 ? "s" : ""} analysé${total > 1 ? "s" : ""}</div>
        ${ref ? `<div class="hero-p">Références de qualité : ${ref === "oui" ? "respectées" : ref === "non" ? "<b class='t-warn'>non respectées</b>" : esc(ref)}</div>` : ""}
      </div>
      ${
        total
          ? `<div class="split">
        <div class="bar"><i class="ok" style="width:${part("ok") + part("na")}%"></i><i class="warn" style="width:${part("warn")}%"></i><i class="bad" style="width:${part("bad")}%"></i></div>
        <div class="split-l"><span class="k-ok">Dans les normes ${n.ok + n.na}</span>${n.warn ? `<span class="k-warn">Hors référence ${n.warn}</span>` : ""}${
              n.bad ? `<span class="k-bad">Hors limite ${n.bad}</span>` : ""
            }</div>
      </div>`
          : ""
      }
    </div>`;
  }

  _tuile(t) {
    const val = lireValeur(t.valeur);
    const e = etatAnalyse(t.valeur, t.limite, t.reference);
    const seuil = seuilTexte(t.limite, t.reference);
    const b = bornes(t.limite) || bornes(t.reference);
    let jauge = "";
    if (b && val.v !== null) {
      const min = b.min ?? 0;
      const max = b.max ?? b.min * 2;
      const marge = (max - min) * 0.25;
      const lo = b.min !== null ? min - marge : 0;
      const hi = max + marge;
      const pos = (x) => Math.min(100, Math.max(0, ((x - lo) / (hi - lo)) * 100));
      jauge = `<div class="jauge"><i class="zone" style="left:${pos(min)}%;width:${pos(max) - pos(min)}%"></i><b class="${e}" style="left:${pos(val.v)}%"></b></div>`;
    }
    // évolution par rapport au prélèvement précédent (historique)
    const h = (t.entity_id && this._histo[t.entity_id]) || [];
    let note = seuil ? `${b && b.min !== null && b.max !== null ? "Normes" : "Limite"} : ${esc(seuil)}` : "";
    if (t.nom === "Dureté" && val.v !== null) note = durete(val.v);
    let evo = "";
    if (h.length >= 2) {
      const delta = h[h.length - 1].v - h[h.length - 2].v;
      const dec = Math.max(decimales(h[h.length - 1].brut), decimales(h[h.length - 2].brut));
      evo =
        Math.abs(delta) < 1e-9
          ? `<div class="evo neutre">= stable depuis le ${esc(dateCourte(h[h.length - 2].t))}</div>`
          : `<div class="evo neutre">${delta > 0 ? "▲ +" : "▼ −"}${fr(Math.abs(delta), dec)} depuis le ${esc(dateCourte(h[h.length - 2].t))}</div>`;
    }
    const mesure = t.date ? `<div class="tuile-n">Mesuré le ${esc(new Date(t.date).toLocaleDateString("fr-FR"))}</div>` : "";
    const chiffre = val.v === null ? esc(t.valeur ?? "—") : `${val.inf ? "&lt; " : ""}${esc(val.brut)}`;
    const choisie = t.entity_id && this._config.historique > 0 && this._choix === t.parametre;
    return `<div class="tuile e-${e}${choisie ? " on" : ""}${t.entity_id && this._config.historique > 0 ? " cliquable" : ""}"${
      t.entity_id ? ` data-tuile="${esc(t.parametre)}" title="Voir l'historique"` : ""
    }>
      <div class="tuile-l"><span class="dot"></span>${esc(t.nom)}</div>
      <div class="tuile-v">${chiffre}${val.unite ? `<span>${esc(val.unite)}</span>` : ""}</div>
      ${jauge}
      ${evo}
      ${note ? `<div class="tuile-n">${note}</div>` : ""}
      ${mesure}
    </div>`;
  }

  _graphique(tuiles) {
    const c = this._config;
    if (!(c.historique > 0)) return "";
    const t = tuiles.find((x) => x.parametre === this._choix);
    if (!t?.entity_id) return "";
    const pts = (this._histo[t.entity_id] || []).slice(-Math.max(2, Number(c.historique) || 12));
    const unite = lireValeur(t.valeur).unite;
    if (pts.length < 2) {
      return `<div class="chart"><div class="chart-h"><span>Historique · ${esc(t.nom)}</span></div>
        <div class="attente">${this._histoSig ? "Pas encore assez de prélèvements enregistrés dans l'historique de Home Assistant." : "Chargement de l'historique…"}</div></div>`;
    }
    const b = bornes(t.limite) || bornes(t.reference);
    const vals = pts.map((p) => p.v);
    const vmax = Math.max(...vals);
    // un seuil très au-dessus des valeurs (nitrates ~9 pour une limite de 50) écraserait la courbe : hors échelle
    const maxVisible = b?.max !== null && b?.max !== undefined && !(vmax > 0 && b.max > vmax * 3);
    let lo = Math.min(...vals, b?.min ?? Infinity);
    let hi = Math.max(vmax, maxVisible ? b.max : -Infinity);
    if (lo > 0 && lo < hi * 0.5) lo = 0;
    if (hi === lo) {
      hi += 1;
      lo = Math.max(0, lo - 1);
    }
    const pad = (hi - lo) * 0.12;
    if (lo > 0) lo = Math.max(0, lo - pad);
    else if (lo < 0) lo -= pad;
    hi += pad;
    const W = 600;
    const H = 140;
    const X = (i) => 18 + (i * (W - 36)) / (pts.length - 1);
    const Y = (v) => H - 10 - ((v - lo) / (hi - lo)) * (H - 24);
    const sel = this._point !== null && this._point < pts.length ? this._point : pts.length - 1;
    const seuils = [];
    if (maxVisible) seuils.push({ v: b.max, l: `max ${fr(b.max)}` });
    if (b?.min !== null && b?.min !== undefined && b.min >= lo) seuils.push({ v: b.min, l: `min ${fr(b.min)}` });
    const ligne = pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
    const aire = `${X(0).toFixed(1)},${H - 10} ${ligne} ${X(pts.length - 1).toFixed(1)},${H - 10}`;
    const p = pts[sel];
    const etatPt = (v) => (hors(v, bornes(t.limite)) ? "bad" : hors(v, bornes(t.reference)) ? "warn" : "ok");
    return `<div class="chart">
      <div class="chart-h"><span>Historique · ${esc(t.nom)}${unite ? ` (${esc(unite)})` : ""}</span>
        <span class="sel">${esc(p.t.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }))} : <b>${valeurTexte(p)}${unite ? " " + esc(unite) : ""}</b></span></div>
      <div class="trace">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          ${seuils.map((s) => `<line class="seuil" x1="0" x2="${W}" y1="${Y(s.v).toFixed(1)}" y2="${Y(s.v).toFixed(1)}"/>`).join("")}
          <polygon class="aire" points="${aire}"/>
          <polyline class="courbe" points="${ligne}"/>
        </svg>
        ${seuils.map((s) => `<span class="seuil-t" style="top:${((100 * Y(s.v)) / H).toFixed(2)}%">${esc(s.l)}</span>`).join("")}
        ${pts
          .map(
            (q, i) =>
              `<i class="pt ${etatPt(q.v)}${i === sel ? " on" : ""}" data-point="${i}" style="left:${((100 * X(i)) / W).toFixed(2)}%;top:${(
                (100 * Y(q.v)) /
                H
              ).toFixed(2)}%"></i>`
          )
          .join("")}
      </div>
      <div class="jours" style="grid-template-columns:repeat(${pts.length},1fr)">${pts
        .map((q, i) => `<button class="jour${i === sel ? " on" : ""}" data-point="${i}">${esc(dateCourte(q.t))}</button>`)
        .join("")}</div>
    </div>`;
  }

  _liste_html(lignes) {
    const n = lignes.length;
    return `<details class="tout"${this._liste ? " open" : ""}>
      <summary><span>Tous les résultats</span><span class="nb">${n} paramètre${n > 1 ? "s" : ""}</span></summary>
      <div class="rows">${lignes
        .map(
          (r) => `<div class="row e-${r.etat}"><span class="dot"></span><span class="row-n">${esc(String(r.parametre).replace(/\s*\*$/, ""))}</span><span class="row-v">${esc(
            r.valeur
          )}</span><span class="row-s">${esc(seuilTexte(r.limite, r.reference))}</span></div>`
        )
        .join("")}</div>
    </details>`;
  }
}

const themeClassEau = (theme, hass) => {
  const clair = hass?.themes?.darkMode === false;
  if (theme === "ha") return `th-ha${clair ? " light" : ""}`;
  if (theme === "auto") return `th-v2${clair ? " light" : ""}`;
  return "th-v2";
};

const PANNEAU_STYLE_BASE = `<style>
:host {
  --med-bg: #1a2434; --med-surface: #212d40; --med-line: #2f3d55;
  --med-text: #e7edf5; --med-muted: #8fa0b8;
  --med-green: #96d21f; --med-blue: #1d93e3;
  --eau-ok: #5fcf8a; --eau-warn: #f5b82e; --eau-bad: #ee4a4a;
}
ha-card { display: block; background: var(--med-bg); color: var(--med-text); border: 1px solid var(--med-line);
  border-radius: 18px; overflow: hidden; font-variant-numeric: tabular-nums; container-type: inline-size; padding-bottom: 12px; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px 8px; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.brand svg { width: 34px; height: 34px; fill: none; flex: none; }
.brand .house { stroke: var(--med-green); stroke-width: 2.4; stroke-linejoin: round; stroke-linecap: round; }
.brand .drop { fill: var(--med-accent, var(--med-blue)); }
.brand .glint { stroke: rgba(255,255,255,.75); stroke-width: 1.3; stroke-linecap: round; }
.title { font-size: 1.15rem; font-weight: 700; letter-spacing: .2px; }
.sub { font-size: .78rem; color: var(--med-muted); }
.pills { display: flex; gap: 8px; flex-wrap: wrap; }
.pill { display: flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px;
  background: var(--med-surface); border: 1px solid var(--med-line); font-size: .78rem; }
.pill-l { color: var(--med-muted); }
.pill-v { font-weight: 600; }
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; background: var(--med-muted); flex: none; }
.p-ok .dot, .e-ok .dot { background: var(--eau-ok); }
.p-warn .dot, .e-warn .dot { background: var(--eau-warn); }
.p-bad .dot, .e-bad .dot { background: var(--eau-bad); }
.p-bad .pill-v { color: var(--eau-bad); }

.hero { margin: 4px 12px 0; padding: 16px; border-radius: 14px; background: var(--med-surface);
  border: 1px solid var(--med-line); display: grid; grid-template-columns: 1fr auto; gap: 6px 16px; }
.hero-l { color: var(--med-muted); font-size: .85rem; }
.hero-l::first-letter { text-transform: uppercase; }
.hero-v { font-size: 2.1rem; font-weight: 700; line-height: 1.15; margin-top: 2px; }
.hero-v.ok { color: var(--eau-ok); } .hero-v.bad { color: var(--eau-bad); } .hero-v.na { color: var(--med-muted); }
.hero-r { text-align: right; align-self: center; }
.big { font-size: 1.6rem; font-weight: 700; color: var(--med-accent, var(--med-blue)); line-height: 1.1; }
.hero-p { font-size: .75rem; color: var(--med-muted); margin-top: 4px; max-width: 190px; margin-left: auto; }
.t-warn { color: var(--eau-warn); font-weight: 600; }
.evo { font-size: .8rem; font-weight: 600; margin-top: 4px; color: var(--med-muted); }
.evo.neutre { font-weight: 500; font-size: .74rem; }
.split { grid-column: 1 / -1; margin-top: 8px; }
.bar { display: flex; height: 8px; border-radius: 6px; overflow: hidden; background: var(--med-line); }
.bar i { display: block; } .bar .ok { background: var(--eau-ok); } .bar .warn { background: var(--eau-warn); } .bar .bad { background: var(--eau-bad); }
.split-l { display: flex; justify-content: space-between; gap: 8px; font-size: .78rem; margin-top: 6px; flex-wrap: wrap; }
.k-ok { color: var(--eau-ok); } .k-warn { color: var(--eau-warn); } .k-bad { color: var(--eau-bad); }

.tuiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin: 10px 12px 0; }
@container (min-width: 620px) { .tuiles { grid-template-columns: repeat(4, 1fr); } .tuiles.trois { grid-template-columns: repeat(3, 1fr); } }
.tuile { padding: 12px; border-radius: 12px; border: 1px solid var(--med-line); min-width: 0; }
.tuile.cliquable { cursor: pointer; }
.tuile.cliquable:hover { border-color: var(--med-muted); }
.tuile.on { border-color: var(--med-accent, var(--med-blue)); background: var(--med-surface); }
.tuile-l { display: flex; align-items: center; gap: 6px; font-size: .78rem; color: var(--med-muted); }
.tuile-l .dot { width: 7px; height: 7px; }
.tuile-v { font-size: 1.35rem; font-weight: 700; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tuile-v span { font-size: .85rem; font-weight: 500; color: var(--med-muted); margin-left: 4px; }
.tuile.e-bad .tuile-v { color: var(--eau-bad); } .tuile.e-warn .tuile-v { color: var(--eau-warn); }
.tuile-n { font-size: .72rem; color: var(--med-muted); margin-top: 4px; }
.tuile-n::first-letter { text-transform: uppercase; }
.jauge { position: relative; height: 6px; border-radius: 4px; background: var(--med-line); margin: 8px 2px 2px; }
.jauge .zone { position: absolute; top: 0; bottom: 0; border-radius: 4px; background: color-mix(in srgb, var(--eau-ok) 35%, transparent); }
.jauge b { position: absolute; top: 50%; width: 11px; height: 11px; border-radius: 50%; transform: translate(-50%, -50%);
  background: var(--eau-ok); border: 2px solid var(--med-bg); }
.jauge b.warn { background: var(--eau-warn); } .jauge b.bad { background: var(--eau-bad); } .jauge b.na { background: var(--med-muted); }

.chart { margin: 14px 12px 0; }
.chart-h { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: .82rem; color: var(--med-muted); margin: 0 4px 6px; }
.chart-h .sel b { color: var(--med-text); }
.trace { position: relative; height: 130px; }
.chart svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; overflow: visible; }
.chart .courbe { fill: none; stroke: var(--med-accent, var(--med-blue)); stroke-width: 2.2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.chart .aire { fill: color-mix(in srgb, var(--med-accent, var(--med-blue)) 14%, transparent); }
.chart .seuil { stroke: var(--eau-bad); stroke-width: 1; stroke-dasharray: 5 4; vector-effect: non-scaling-stroke; opacity: .7; }
.seuil-t { position: absolute; right: 2px; transform: translateY(-115%); color: var(--eau-bad); font-size: .66rem; opacity: .85; }
.pt { position: absolute; width: 8px; height: 8px; border-radius: 50%; transform: translate(-50%, -50%); cursor: pointer;
  background: var(--med-bg); border: 2px solid var(--eau-ok); }
.pt.warn { border-color: var(--eau-warn); } .pt.bad { border-color: var(--eau-bad); }
.pt.on { width: 12px; height: 12px; background: var(--med-accent, var(--med-blue)); border-color: var(--med-text); }
.attente { font-size: .8rem; color: var(--med-muted); border-top: 1px dashed var(--med-line); padding: 10px 4px 0; }
.jours { display: grid; margin-top: 4px; }
.jour { all: unset; cursor: pointer; text-align: center; padding: 4px 0; border-radius: 8px; font-size: .66rem; color: var(--med-muted); }
.jour.on { background: var(--med-surface); color: var(--med-text); font-weight: 600; }
.jour:focus-visible { outline: 2px solid var(--med-accent, var(--med-blue)); }

.concl { margin: 12px 12px 0; padding: 12px; border-radius: 12px; border: 1px solid var(--med-line); font-size: .85rem; line-height: 1.4; }
.concl .tuile-l { margin-bottom: 4px; }

details.tout { margin: 12px 12px 0; border: 1px solid var(--med-line); border-radius: 12px; }
details.tout summary { list-style: none; cursor: pointer; display: flex; justify-content: space-between; align-items: center;
  padding: 10px 12px; font-size: .85rem; user-select: none; }
details.tout summary::-webkit-details-marker { display: none; }
details.tout summary::after { content: "›"; font-size: 1.2rem; color: var(--med-muted); transform: rotate(90deg); transition: transform .2s; margin-left: 8px; }
details.tout[open] summary::after { transform: rotate(-90deg); }
details.tout summary .nb { margin-left: auto; color: var(--med-muted); font-size: .78rem; }
.rows { border-top: 1px solid var(--med-line); padding: 4px 12px 8px; }
.row { display: grid; grid-template-columns: auto 1fr auto; gap: 2px 8px; align-items: center; padding: 7px 0; font-size: .8rem;
  border-bottom: 1px solid var(--med-line); }
.row:last-child { border-bottom: none; }
.row .dot { width: 7px; height: 7px; }
.row-v { font-weight: 600; text-align: right; white-space: nowrap; }
.row-s { grid-column: 2 / -1; font-size: .7rem; color: var(--med-muted); }
.row-s:empty { display: none; }
.row.e-bad .row-v { color: var(--eau-bad); } .row.e-warn .row-v { color: var(--eau-warn); }

footer { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin: 12px 18px 0; font-size: .72rem; color: var(--med-muted); }
footer a { color: inherit; }
.vide { padding: 18px; color: var(--med-muted); }

ha-card.th-ha {
  --med-accent: var(--primary-color, #1d93e3);
  --med-bg: var(--ha-card-background, var(--card-background-color, #fff));
  --med-surface: color-mix(in srgb, var(--primary-text-color, #000) 5%, transparent);
  --med-line: var(--divider-color, rgba(127, 127, 127, .25));
  --med-text: var(--primary-text-color, #1f2937);
  --med-muted: var(--secondary-text-color, #6b7280);
  --eau-ok: var(--success-color, #43a047); --eau-warn: var(--warning-color, #ffa600); --eau-bad: var(--error-color, #db4437);
  border-radius: var(--ha-card-border-radius, 12px);
  border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color, #e0e0e0));
}
ha-card.th-ha.light { --med-green: #4c8a0b; }
ha-card.th-v2.light {
  --med-bg: #ffffff; --med-surface: #f2f5f9; --med-line: #dbe2ec;
  --med-text: #1a2434; --med-muted: #5b6b82;
  --med-green: #4c8a0b; --med-blue: #1673b8;
  --eau-ok: #1d8a4b; --eau-warn: #b77d00; --eau-bad: #c62828;
  box-shadow: 0 1px 3px rgba(26, 36, 52, .08);
}
ha-card.light .brand .glint { stroke: rgba(255,255,255,.9); }
@media (max-width: 420px) { .hero-v { font-size: 1.8rem; } }
@container (max-width: 440px) {
  .hero { grid-template-columns: 1fr; }
  .hero-r { text-align: left; display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 8px; }
  .hero-r .big { font-size: 1.15rem; }
  .hero-p { margin: 0; max-width: none; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>`;
// Variable --fs (réglage « taille du texte ») : sans réglage elle vaut 1 et rien ne change.
const PANNEAU_STYLE = PANNEAU_STYLE_BASE.replace(/(-?\d*\.?\d+)rem/g, "calc($1rem * var(--fs, 1))");

if (!customElements.get("qualite-eau-panneau-card")) {
  customElements.define("qualite-eau-panneau-card", QualiteEauPanneauCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "qualite-eau-panneau-card",
    name: "Qualité de l'eau · Panneau",
    description: "Bulletin du contrôle sanitaire en tableau de bord : conformité, paramètres clés et historique",
    preview: true,
    documentationURL: "https://github.com/Marlboro62/ha-qualite-eau",
  });
}

if (!customElements.get("qualite-eau-card")) {
  customElements.define("qualite-eau-card", QualiteEauCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "qualite-eau-card",
    name: "Qualité de l'eau",
    description: "Dernier bulletin du contrôle sanitaire de l'eau potable (Orobnat)",
    preview: true,
    documentationURL: "https://github.com/Marlboro62/ha-qualite-eau",
  });
  console.info(`%c QUALITE-EAU-CARD %c ${CARD_VERSION} `, "background:#0288d1;color:#fff", "");
}
