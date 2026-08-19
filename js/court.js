/* Kort bölge seçici: sahayı soldan sağa 5 dikey şeride ayırır (1-5).
 * Basit ve tek dokunuşla hızlı seçim için tasarlandı; gerçek kort çizgileri
 * sadece görsel referans amaçlıdır.
 */
const ZONE_COLORS = ["#e03131", "#f08c00", "#2f9e44", "#1971c2", "#7048e8"];

function renderZonePicker(container, { selected = null, onSelect } = {}) {
  container.innerHTML = "";
  const svgNS = "http://www.w3.org/2000/svg";
  const W = 220, H = 65, M = 6;
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "zone-svg");

  // kort dış çizgisi
  const court = document.createElementNS(svgNS, "rect");
  court.setAttribute("x", M); court.setAttribute("y", M);
  court.setAttribute("width", W - M * 2); court.setAttribute("height", H - M * 2);
  court.setAttribute("class", "court-outline");
  svg.appendChild(court);

  // file (net) çizgisi - üstte
  const net = document.createElementNS(svgNS, "line");
  net.setAttribute("x1", M); net.setAttribute("y1", M);
  net.setAttribute("x2", W - M); net.setAttribute("y2", M);
  net.setAttribute("class", "court-net");
  svg.appendChild(net);

  // orta servis çizgisi (görsel referans)
  const midLine = document.createElementNS(svgNS, "line");
  midLine.setAttribute("x1", W / 2); midLine.setAttribute("y1", M);
  midLine.setAttribute("x2", W / 2); midLine.setAttribute("y2", H - M);
  midLine.setAttribute("class", "court-mid");
  svg.appendChild(midLine);

  const zoneCount = 5;
  const zoneW = (W - M * 2) / zoneCount;
  for (let i = 1; i <= zoneCount; i++) {
    const x = M + (i - 1) * zoneW;
    const g = document.createElementNS(svgNS, "g");
    g.setAttribute("class", "zone" + (selected === i ? " zone-selected" : ""));
    g.setAttribute("data-zone", i);
    g.style.cursor = "pointer";

    const rect = document.createElementNS(svgNS, "rect");
    rect.setAttribute("x", x); rect.setAttribute("y", M);
    rect.setAttribute("width", zoneW); rect.setAttribute("height", H - M * 2);
    rect.setAttribute("class", "zone-rect");
    rect.style.fill = ZONE_COLORS[i - 1];
    rect.style.fillOpacity = selected === i ? 0.9 : 0.4;
    rect.style.stroke = selected === i ? "#1a1a1a" : "rgba(255,255,255,0.6)";
    rect.style.strokeWidth = selected === i ? 2.5 : 1;
    g.appendChild(rect);

    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("x", x + zoneW / 2);
    text.setAttribute("y", H / 2);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.setAttribute("class", "zone-label");
    text.textContent = i;
    g.appendChild(text);

    g.addEventListener("click", () => {
      container.querySelectorAll(".zone").forEach(z => z.classList.remove("zone-selected"));
      g.classList.add("zone-selected");
      onSelect && onSelect(i);
    });

    svg.appendChild(g);
  }

  container.appendChild(svg);
}
