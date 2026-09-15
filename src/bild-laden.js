// Laedt ein Bild von Discord - mit Pruefung, dass es wirklich vollstaendig
// angekommen ist.
//
// Kevins Beobachtung: manchmal liest Ghostxx eine ganze Reihe Bilder tadellos,
// dann kackt er bei mehreren hintereinander rein, dann wieder gut - und das
// hat nichts mit der Schwierigkeit der Bilder zu tun. Nachgemessen: dasselbe
// Bild liest sich auf ruhiger Grafikkarte fuenfmal hintereinander IDENTISCH -
// das Modell selbst ist deterministisch. Die Ursache muss also vor dem Lesen
// liegen.
//
// Gefunden: keine der Download-Stellen hat je geprueft, ob die Antwort
// vollstaendig war. `res.ok` ist bei einem abgeschnittenen Download durch
// einen kurzen Netzwerkhaenger trotzdem `true` - Discord schickt einen
// gueltigen HTTP-Status, auch wenn die Verbindung mittendrin abbricht. Ein
// unvollstaendiges Bild sieht fuer das Modell aus wie ein extrem schwer
// lesbares - es "kackt rein", obwohl das Bild selbst tadellos war.
//
// Deshalb hier: die Content-Length aus der Antwort mit der tatsaechlich
// angekommenen Groesse vergleichen, bei Abweichung einmal neu laden.

async function ladeBildSicher(url, maxVersuche = 2) {
  for (let versuch = 1; versuch <= maxVersuche; versuch += 1) {
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) continue;

    const buffer = Buffer.from(await res.arrayBuffer());

    // Discord nennt die erwartete Groesse fast immer - fehlt der Header
    // ausnahmsweise, wird nicht blockiert, nur eben nicht geprueft.
    const erwartet = Number(res.headers.get('content-length') || 0);
    if (erwartet && buffer.length !== erwartet) continue;

    // Kein echtes Bild kommt unter 100 Byte an - eher ein leerer oder
    // abgebrochener Download.
    if (buffer.length < 100) continue;

    return buffer;
  }

  return null;
}

module.exports = { ladeBildSicher };
