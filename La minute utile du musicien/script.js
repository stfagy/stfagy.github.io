// frontend/script.js

// ============ Constantes & Variables globales ============
// ============ Constantes & Variables globales ============
let instruments       = [];   // sera rempli depuis instruments.json
let currentInstrument = null;
let currentTuning     = [];
let currentMarkers    = [];
let currentFrets   = null;

const API_URL    = "https://stf-minute-api.onrender.com/fretboard";
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const INTERVALS_MAPPING = {
  0:  { label: "R",  color: "#000000" },
  1:  { label: "b2", color: "#e7c502" },
  2:  { label: "M2", color: "#e7c502" },
  3:  { label: "b3", color: "#ff0400" },
  4:  { label: "M3", color: "#ff0400" },
  5:  { label: "P4", color: "#00CFFF" },
  6:  { label: "b5", color: "#43ff0c" },
  7:  { label: "P5", color: "#43ff0c" },
  8:  { label: "b6", color: "#9a29fd" },
  9:  { label: "M6", color: "#9a29fd" },
  10: { label: "b7", color: "#268cf8" },
  11: { label: "M7", color: "#268cf8" }
};
// Juste après la déclaration de INTERVALS_MAPPING
const ALT_INTERVAL_LABELS = {
  2:  "bb3", // M2 → bb3
  3:  "#2",   // b3 → #2
  4:  "b4",  // M3 → b4
  6:  "#4",  // b6 → #5
  8:  "#5",  // #5 → b4 (triton)
  9:  "bb7", // M6 → bb7
  10: "#6"   // b7 → #6
};

let scalesList = [];   // tableau de { name, pattern }
let chordsList = [];   // tableau de { name, pattern }

// ============ Initialisation ============
document.addEventListener("DOMContentLoaded", () => {
  Promise.all([
    fetch("scales.json").then(r => r.json()),
    fetch("chords.json").then(r => r.json()),
    fetch("instruments.json").then(r => r.json())
  ])
  .then(([scaleData, chordData, instrData]) => {
    scalesList   = scaleData;
    chordsList   = chordData;
    instruments  = instrData;
    populateInstrumentSelector();      // ← nouvelle fonction
    populateSelectors();
    setupEventListeners();
  })
  .catch(console.error);
});

function populateInstrumentSelector() {
  const sel = document.getElementById("instrument");
  sel.innerHTML = "";
  instruments.forEach(ins => {
    const o   = document.createElement("option");
    o.value   = ins.id;
    o.textContent = ins.label;
    sel.appendChild(o);
  });
  // valeur initiale = premier instrument du JSON
  currentInstrument = instruments[0].id;
  currentTuning     = instruments[0].tuning;
  currentMarkers    = instruments[0].markers;
  currentFrets     = instruments[0].frets;
  sel.value         = currentInstrument;
}

function onInstrumentChange() {
  const id = document.getElementById("instrument").value;
  const ins = instruments.find(i => i.id === id);
  if (!ins) return;
  currentInstrument = id;
  currentTuning     = ins.tuning;
  currentMarkers    = ins.markers;
  currentFrets     = ins.frets;
  drawFretboard();
}

// Charge scales.json et chords.json (formats tableaux ordonnés)
function loadPatterns() {
  Promise.all([
    fetch("scales.json").then(r => r.json()),
    fetch("chords.json").then(r => r.json())
  ])
  .then(([scaleData, chordData]) => {
    scalesList = scaleData;
    chordsList = chordData;
    populateSelectors();
  })
  .catch(console.error);
}

// ============ Peuplement des <select> ============
function populateSelectors() {
  const rootSel  = document.getElementById("root");
  const scaleSel = document.getElementById("scaleSelect");
  const chordSel = document.getElementById("chordSelect");

  // 1) Racines
  rootSel.innerHTML = "";
  NOTE_NAMES.forEach(n => {
    const o = document.createElement("option");
    o.value = o.textContent = n;
    rootSel.appendChild(o);
  });

  // 2) Gammes
  scaleSel.innerHTML = '<option value="">-- aucune --</option>';
  scalesList.forEach(e => {
    const o = document.createElement("option");
    o.value = o.textContent = e.name;
    scaleSel.appendChild(o);
  });

  // 3) Accords
  chordSel.innerHTML = '<option value="">-- aucun --</option>';
  chordsList.forEach(e => {
    const o = document.createElement("option");
    o.value = o.textContent = e.name;
    chordSel.appendChild(o);
  });

  // 4) Valeurs par défaut + premier rendu
  rootSel.value  = "C";
  scaleSel.value = scalesList.length ? scalesList[0].name : "";
  chordSel.value = "";
  drawFretboard();
}

// ============ Gestion des événements ============
function setupEventListeners() {
  document.getElementById("root").addEventListener("change", drawFretboard);
  document.getElementById("instrument").addEventListener("change", onInstrumentChange);
  document.getElementById("scaleSelect").addEventListener("change", () => {
    document.getElementById("chordSelect").value = "";
    drawFretboard();
  });
  document.getElementById("chordSelect").addEventListener("change", () => {
    document.getElementById("scaleSelect").value = "";
    drawFretboard();
  });
  document.getElementById("displayMode").addEventListener("change", drawFretboard);
}

// ============ Fonction principale ============
function drawFretboard() {
  const root      = document.getElementById("root").value;
  const scaleName = document.getElementById("scaleSelect").value;
  const chordName = document.getElementById("chordSelect").value;

  // Récupération de l'entrée choisie et de son pattern
  let entry, pattern;
  if (scaleName) {
    entry   = scalesList.find(e => e.name === scaleName);
    pattern = entry?.pattern;
  } else if (chordName) {
    entry   = chordsList.find(e => e.name === chordName);
    pattern = entry?.pattern;
  }
  // Normalise le motif sur 12 demi-tons
  const pattern12 = pattern.map(p => ((p % 12) + 12) % 12);
  // Rien à afficher ?
  if (!pattern) {
    document.getElementById("titleDisplay").textContent    = "";
    document.getElementById("intervalDisplay").innerHTML  = "";
    document.getElementById("circleDiagram").innerHTML    = "";
    document.getElementById("fretboard").innerHTML        = "";
    return;
  }

  // 1) Titre en haut : "C Pentatonique Majeure" ou "D m7"
  document.getElementById("titleDisplay").textContent = `${root} ${entry.name}`;

  // 2) Requête à l’API
  const query = `root=${encodeURIComponent(root)}&` +
               pattern.map(p => `pattern=${p}`).join("&") + "&" +
                currentTuning.map(t => `tuning=${encodeURIComponent(t)}`).join("&") + "&" +
                `frets=${currentFrets}`;
  fetch(`${API_URL}?${query}`)
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(({ board, scale_notes }) => {
      renderSVG(board);
      renderIntervalDisplay(pattern12, scale_notes);
      drawCircleDiagram(root, pattern12, scale_notes,
                        document.getElementById("displayMode").checked);
    })
    .catch(console.error);
}

// ============ Dessin du manche (SVG) ============
function renderSVG(board) {
  const svg = document.getElementById("fretboard");

  // --- constantes de dessin ---
  const W = 50, H = 40, R = 12,
        F = currentFrets,
        off = W / 2;

  // --- calcul des dimensions réelles ---
  const totalWidth  = (F * W) + off + R;       // +R pour ne pas rogner la dernière pastille
  const totalHeight = (board.length + 2) * H;

  // --- viewport adaptatif ---
  svg.setAttribute("viewBox", `0 0 ${totalWidth} ${totalHeight}`);
  svg.removeAttribute("width");                // le SVG remplira la largeur disponible
  svg.setAttribute("height", totalHeight);     // hauteur fixe selon nombre de cordes

  svg.innerHTML = "";                          // on efface l’ancien contenu

  // --- le reste du code inchangé ---
  const showI  = document.getElementById("displayMode").checked;
  const markers = currentMarkers;

  // Frettes
  for (let f = 1; f <= F; f++) {
    const x   = f * W;
    const l   = document.createElementNS("http://www.w3.org/2000/svg","line");
    l.setAttribute("x1", x); l.setAttribute("y1", H);
    l.setAttribute("x2", x); l.setAttribute("y2", H * board.length);
    l.setAttribute("stroke", "#555");
    svg.appendChild(l);
  }
  // Sillet
  const nut = document.createElementNS("http://www.w3.org/2000/svg","line");
  nut.setAttribute("x1", W); nut.setAttribute("y1", H);
  nut.setAttribute("x2", W); nut.setAttribute("y2", H * board.length);
  nut.setAttribute("stroke", "#000"); nut.setAttribute("stroke-width", "6");
  svg.appendChild(nut);

  // Cordes + notes
  board.forEach((stringData, i) => {
    const y = (i+1) * H;
    // corde
    const sLine = document.createElementNS("http://www.w3.org/2000/svg","line");
    sLine.setAttribute("x1", W); sLine.setAttribute("y1", y);
    sLine.setAttribute("x2", F*W+off); sLine.setAttribute("y2", y);
    sLine.setAttribute("stroke", "#aaa");
    svg.appendChild(sLine);

    // pastilles & labels
    stringData.forEach(n => {
      const x = n.fret * W + off;
      if (n.interval === "R") {
        const sq = document.createElementNS("http://www.w3.org/2000/svg","rect");
        sq.setAttribute("x", x-R); sq.setAttribute("y", y-R);
        sq.setAttribute("width", 2*R); sq.setAttribute("height", 2*R);
        sq.setAttribute("fill", "#000");
        svg.appendChild(sq);
      } else {
        const c = document.createElementNS("http://www.w3.org/2000/svg","circle");
        c.setAttribute("cx", x); c.setAttribute("cy", y);
        c.setAttribute("r", R); c.setAttribute("fill", n.color);
        svg.appendChild(c);
      }
      const txt = document.createElementNS("http://www.w3.org/2000/svg","text");
      txt.setAttribute("x", x); txt.setAttribute("y", y+3);
      txt.setAttribute("text-anchor","middle");
      txt.setAttribute("dominant-baseline","middle");
      txt.setAttribute("fill","white");
      txt.setAttribute("font-size","10");
      txt.textContent = showI ? n.interval : n.note;
      svg.appendChild(txt);
    });
  });

  // Repères (5,7,10,12)
  markers.forEach(f => {
    const dot = document.createElementNS("http://www.w3.org/2000/svg","circle");
    dot.setAttribute("cx", f*W+off);
    dot.setAttribute("cy", (board.length+1.5)*H);
    dot.setAttribute("r", 6);
    dot.setAttribute("fill", "#333");
    svg.appendChild(dot);
  });
}

// ============ Affichage des intervalles + notes (liste) ============
function renderIntervalDisplay(pattern, scale_notes) {
  const iv = document.getElementById("intervalDisplay");
  iv.innerHTML = "";
  const showI = document.getElementById("displayMode").checked;

  pattern.forEach((p, idx) => {
    const { label } = INTERVALS_MAPPING[p];
    const color     = (p === 0 ? "#000" : INTERVALS_MAPPING[p].color);
    const noteName  = scale_notes[idx];
    const container = document.createElement("div");
    container.style.display   = "inline-block";
    container.style.textAlign = "center";
    container.style.margin    = "0 8px";

    // pastille intervalle
    const spanI = document.createElement("span");
    spanI.textContent           = label;
    spanI.style.backgroundColor = color;
    spanI.style.color           = "#fff";
    spanI.style.padding         = "4px 8px";
    spanI.style.borderRadius    = "4px";
    spanI.style.display         = "block";
    container.appendChild(spanI);

    // note
    const spanN = document.createElement("span");
    spanN.textContent   = noteName;
    spanN.style.display = "block";
    spanN.style.marginTop = "4px";
    container.appendChild(spanN);

    iv.appendChild(container);
  });
}

// ============ Diagramme circulaire 12-tons ============
function drawCircleDiagram(root, pattern, scale_notes, showIntervals) {
  const svg   = document.getElementById("circleDiagram");
  const size  = 240, cx = size/2, cy = size/2;
  const r     = size * 0.35, rCircle = r - 8;
  const step  = (2 * Math.PI) / 12;
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.innerHTML = "";

  // contour du cercle
  const circle = document.createElementNS("http://www.w3.org/2000/svg","circle");
  circle.setAttribute("cx", cx);
  circle.setAttribute("cy", cy);
  circle.setAttribute("r",  rCircle);
  circle.setAttribute("fill", "none");
  circle.setAttribute("stroke", "#555");
  circle.setAttribute("stroke-width", "2");
  svg.appendChild(circle);

  // segments radiaux + pastilles + labels
  for (let i = 0; i < 12; i++) {
    const angle    = -Math.PI/2 + i * step;
    const xSeg     = cx + Math.cos(angle) * r * 0.8;
    const ySeg     = cy + Math.sin(angle) * r * 0.8;
    const idx      = pattern.indexOf(i);
    const isActive = idx !== -1;
    const col      = isActive
      ? (i===0?"#000":INTERVALS_MAPPING[i].color)
      : "#DDD";
    const width    = isActive ? 3 : 1;

    // segment radial
    const line = document.createElementNS("http://www.w3.org/2000/svg","line");
    line.setAttribute("x1", cx);
    line.setAttribute("y1", cy);
    line.setAttribute("x2", xSeg);
    line.setAttribute("y2", ySeg);
    line.setAttribute("stroke", col);
    line.setAttribute("stroke-width", width);
    svg.appendChild(line);

    if (isActive) {
      // pastille
      const circ = document.createElementNS("http://www.w3.org/2000/svg","circle");
      circ.setAttribute("cx", xSeg);
      circ.setAttribute("cy", ySeg);
      circ.setAttribute("r", 6);
      circ.setAttribute("fill", i===0?"#000":INTERVALS_MAPPING[i].color);
      svg.appendChild(circ);

      // label
      const label = showIntervals
        ? INTERVALS_MAPPING[i].label
        : scale_notes[idx];
      const tx = cx + Math.cos(angle) * (r + 12);
      const ty = cy + Math.sin(angle) * (r + 12);
      const txt = document.createElementNS("http://www.w3.org/2000/svg","text");
      txt.setAttribute("x", tx);
      txt.setAttribute("y", ty);
      txt.setAttribute("text-anchor","middle");
      txt.setAttribute("dominant-baseline","middle");
      txt.setAttribute("fill","#000");
      txt.setAttribute("font-size","10");
      txt.textContent = label;
      svg.appendChild(txt);
    }
  }
}
