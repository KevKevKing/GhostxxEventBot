const { check, equal, finish, section } = require('./lib');
const { ladeBildSicher } = require('../src/bild-laden');

// Kevins Beobachtung: Ghostxx liest mal eine ganze Reihe tadellos, dann
// mehrere hintereinander schlecht, dann wieder gut - unabhaengig davon, wie
// schwer die Bilder eigentlich sind. Nachgemessen: dasselbe Bild liest sich
// auf ruhiger Grafikkarte fuenfmal identisch, das Modell ist deterministisch.
//
// Der echte Fehler lag davor: keine Download-Stelle hat je geprueft, ob ein
// Bild wirklich vollstaendig angekommen ist. Ein kurzer Netzwerkhaenger kann
// eine abgeschnittene Antwort liefern, mit ganz normalem res.ok=true - fuer
// das Modell sieht das aus wie ein besonders schwer lesbares Bild.

const echterFetch = global.fetch;

function fetchMock(antworten) {
  let i = 0;
  global.fetch = async () => {
    const a = antworten[Math.min(i, antworten.length - 1)];
    i += 1;
    if (a === null) throw new Error('Netzwerkfehler');
    return a;
  };
}

function antwort({ ok = true, laenge, bytes }) {
  const buf = Buffer.alloc(bytes ?? laenge ?? 0, 1);
  return {
    ok,
    headers: { get: (name) => (name === 'content-length' && laenge !== undefined ? String(laenge) : null) },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

(async () => {
  section('Vollstaendiger Download');
  fetchMock([antwort({ laenge: 500, bytes: 500 })]);
  const gut = await ladeBildSicher('https://x/bild.png');
  equal('kommt durch', gut?.length, 500);

  section('Abgeschnittener Download - genau das war der Fehler');
  // Content-Length sagt 500, angekommen sind nur 120 - ein Netzwerkhaenger
  // mitten in der Uebertragung. res.ok war trotzdem true.
  fetchMock([antwort({ laenge: 500, bytes: 120 }), antwort({ laenge: 500, bytes: 500 })]);
  const repariert = await ladeBildSicher('https://x/bild.png');
  equal('zweiter Versuch rettet es', repariert?.length, 500);

  section('Bleibt kaputt - dann auch nach zwei Versuchen nichts');
  fetchMock([antwort({ laenge: 500, bytes: 120 }), antwort({ laenge: 500, bytes: 130 })]);
  const bleibtKaputt = await ladeBildSicher('https://x/bild.png');
  equal('kein Bild statt einem falschen', bleibtKaputt, null);

  section('Ohne Content-Length wird nicht blockiert');
  // Discord schickt den Header fast immer, aber "fast immer" ist nicht immer.
  fetchMock([antwort({ bytes: 500 })]);
  const ohneHeader = await ladeBildSicher('https://x/bild.png');
  equal('kommt trotzdem durch', ohneHeader?.length, 500);

  section('Abgelaufener Link');
  fetchMock([antwort({ ok: false }), antwort({ ok: false })]);
  equal('kein Bild', await ladeBildSicher('https://x/bild.png'), null);

  section('Netzwerkfehler statt Antwort');
  fetchMock([null, antwort({ laenge: 500, bytes: 500 })]);
  const nachFehler = await ladeBildSicher('https://x/bild.png');
  equal('zweiter Versuch rettet es', nachFehler?.length, 500);

  section('Winziges "Bild" ist kein Bild');
  fetchMock([antwort({ bytes: 10 }), antwort({ bytes: 10 })]);
  equal('wird abgelehnt', await ladeBildSicher('https://x/bild.png'), null);

  global.fetch = echterFetch;
  finish();
})();
