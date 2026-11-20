/*
 * Carte « Qualité de l'eau » pour l'intégration Orobnat.
 *
 *   type: custom:qualite-eau-card
 *   entity: sensor.eau_lyon_bulletin
 *   # facultatif :
 *   title: Eau du robinet
 *   parametres: [Nitrates, Chlore libre, pH, Titre hydrotimétrique]  # filtre (début du nom)
 *   conclusions: true
 */
const CARD_VERSION = "1.1.3";

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
      ],
      computeLabel: (s) =>
        ({ entity: "Capteur « Bulletin »", title: "Titre (facultatif)", conclusions: "Afficher les conclusions sanitaires" })[
          s.name
        ],
    };
  }

  setConfig(config) {
    if (!config.entity) throw new Error("Indiquez « entity » : le capteur Bulletin de l'intégration Orobnat");
    this._config = { conclusions: true, ...config };
    this._last = null;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
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
        // « ≥ et ≤ 25 °C » (pas de minimum publié) -> « ≤ 25 °C »
        const seuil = (propre(r.limite) || propre(r.reference)).replace(/≥\s*et\s+/, "").trim();
        return `<tr title="${esc(info)}">
          <td><span class="dot ${etat}"></span>${esc(r.parametre.replace(/\s*\*$/, ""))}</td>
          <td class="val">${esc(r.valeur)}</td>
          <td class="seuil">${esc(seuil)}</td>
        </tr>`;
      })
      .join("");

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
        ${
          lignes
            ? `<table><thead><tr><th>Paramètre</th><th>Valeur</th><th>Seuil</th></tr></thead><tbody>${lignes}</tbody></table>`
            : `<div class="msg">Aucune analyse dans le dernier bulletin.</div>`
        }
        <div class="src"><a class="source" href="${esc(a.source || "https://orobnat.sante.gouv.fr")}" target="_blank" rel="noreferrer">Source : ministère de la Santé / ARS</a></div>
      </ha-card>${STYLE}`;
  }
}

// Orobnat ne sert un bulletin qu'à un navigateur qui a déjà ouvert la page de la région (session) : sans elle,
// l'adresse du bulletin répond en erreur 500. On ouvre donc la page de la région, puis on passe le même onglet
// au département (pour que le formulaire du site montre la bonne commune) et enfin au bulletin. Sans
// « source_bulletin » (ancienne version de l'intégration) ou en clic avec modificateur : simple lien.
const ETAPE_MS = 1500;
const ouvrirBulletin = (ev, a) => {
  if (!a.source || !a.source_bulletin || ev.button || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
  ev.preventDefault();
  const w = window.open(a.source, "_blank");
  if (!w) return; // application mobile : la page de la région s'ouvre dans le navigateur
  const departement = new URL(a.source_bulletin);
  departement.searchParams.set("methode", "changerDepartement");
  const aller = (url) => {
    try {
      if (!w.closed) w.location.href = url;
    } catch (e) {
      /* onglet fermé ou inaccessible : on garde la page de la région */
    }
  };
  setTimeout(() => {
    aller(departement.href);
    setTimeout(() => aller(a.source_bulletin), ETAPE_MS);
  }, ETAPE_MS);
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
</style>`;

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
