const { check, finish, section } = require('./lib');
const { looksLikeCommand, parseIntent } = require('../src/intent-parser');
const { getKnownSlugs } = require('../src/event-actions');

const A = '<@1365073743679852687>';
const B = '<@286819354589265920>';
const ME = '1365073743679852687';
const known = ['40er', '50er', 'Bank-Event', 'BizWar', 'Giesserei', 'Flugzeugtraeger', 'RP-Fabrik', ...getKnownSlugs()];

function t(text, expected, options = {}) {
  const got = parseIntent(text, { knownEvents: known, ...options });
  const ok = expected === null ? got === null : Boolean(got) && got.action === expected;
  const label = got ? `${got.action}${got.needsEvent ? ' [Kontext]' : ` ${got.event}`}` : 'null';
  return check(`${label.padEnd(22)} "${text.replace(/<@\d+>/g, '@X')}"`, ok, JSON.stringify(got));
}

section('Wird erkannt');
t(`Tausche aus dem Event (40er) ${A} mit ${B}`, 'swap');
t(`tausch im 40er ${A} gegen ${B}`, 'swap');
t(`wechsle beim Bank-Event ${A} mit ${B}`, 'swap');
t(`trag ${A} beim 50er ein`, 'add');
t(`pack ${A} als Auswechselspieler ins BizWar`, 'add');
t(`nimm ${A} aus dem Bank-Event raus`, 'remove');
t('wer ist alles beim 40er dabei?', 'list');

section('Tippfehler werden verziehen');
// "weechsel" statt "wechsel" - ab fuenf Buchstaben ein Zeichen Abstand erlaubt.
t(`ghost weechsel ${A} mit ${B}`, 'swap');

section('Selbstbezug ohne Erwaehnung');
// "trag mich ein" ist eindeutig und darf kein Sprachmodell brauchen.
t('trag mich ein', 'add', { selfId: ME, hasReply: true });
t('nimm mich raus', 'remove', { selfId: ME, hasReply: true });
t('trag mich beim 40er ein', 'add', { selfId: ME });
const selbst = parseIntent('trag mich ein', { knownEvents: known, selfId: ME, hasReply: true });
check('  Spieler ist der Schreiber', selbst?.player === ME, JSON.stringify(selbst));

section('Event darf fehlen, kommt aus dem Kontext');
t(`tausche ${A} mit ${B}`, 'swap');
t(`trag ${A} ein`, 'add');

section('Geht ans Modell oder gar nicht');
t('hey wie gehts dir?', null);
t('was ist die hauptstadt von frankreich?', null);
t('wer ist der beste spieler?', null);
t(`tausche im 40er ${A}`, null);
t(`trag ${A} und ${B} beim 40er ein`, null);
t(`nimm ${A} raus und trag ${B} ein beim 40er`, null);
t('wer ist alles dabei?', null);
t('wer ist alles dabei?', 'list', { hasReply: true });

section('Befehlsversuch erkennen (keine Chat-Umleitung)');
check('unvollstaendiger Befehl zaehlt als Befehl', looksLikeCommand(`ghost tausche ${A} mit ${B}`));
check('Tippfehler zaehlt als Befehl', looksLikeCommand(`ghost weechsel ${A} mit ${B}`));
check('Smalltalk zaehlt nicht', !looksLikeCommand('hey ghost wie gehts dir'));
check('Frage zaehlt nicht', !looksLikeCommand('hast du fragen ghost?'));

section('Falsche Freunde');
// "auswechselspieler" enthaelt "wechsel" - darf keinen Tausch ausloesen.
const ersatz = parseIntent(`pack ${A} als Auswechselspieler ins BizWar`, { knownEvents: known });
check('"auswechselspieler" ist kein Tausch', ersatz?.action === 'add', JSON.stringify(ersatz));
check('  und setzt das Ersatz-Kennzeichen', ersatz?.substitute === true);


section('"Ersatz" ist kein Tauschverb');
// "ersatz" und "ersetz" trennt genau ein Buchstabe. Die Tippfehler-Toleranz
// hat "trag @X als Ersatz ein" deshalb fuer einen Tauschversuch gehalten - und
// weil dabei die zweite Person fehlt, kam gar nichts zurueck. Ein voellig
// normaler Satz, der stumm ins Leere lief.
const alsErsatz = parseIntent(`trag ${A} als Ersatz ein`, { selfId: '9' });
check('wird als Eintrag erkannt', alsErsatz?.action === 'add', JSON.stringify(alsErsatz));
check('  und als Auswechselspieler', alsErsatz?.substitute === true);

const aufBank = parseIntent(`pack ${A} auf die Ersatzbank`, { selfId: '9' });
check('Ersatzbank auch', aufBank?.action === 'add' && aufBank.substitute === true, JSON.stringify(aufBank));

// Echte Tippfehler sollen weiterhin verziehen werden.
check('"weechsel" bleibt ein Tausch',
  parseIntent(`weechsel ${A} mit ${B}`, { selfId: '9' })?.action === 'swap');


section('Namen ohne Erwaehnung beim Ein- und Austragen');
// Ging frueher ans Sprachmodell - und das greift bei "nimm Johannes aus dem
// Bank-Event raus" nur in drei von fuenf Faellen zum Werkzeug. Nachgemessen,
// mit und ohne Laengengrenze gleich.
for (const [text, aktion, person] of [
  ['nimm Johannes aus dem Bank-Event raus', 'remove', 'Johannes'],
  ['trag Pascal beim 50er ein', 'add', 'Pascal'],
  ['pack Nox in den 40er rein', 'add', 'Nox'],
  ['schmeiss Danny raus', 'remove', 'Danny'],
  ['nimm Ghost Muffiin raus', 'remove', 'Ghost Muffiin'],
  ['trag Fedex Wave als Ersatz ein', 'add', 'Fedex Wave'],
]) {
  const r = parseIntent(text, { selfId: '9', knownEvents: ['40er', '50er', 'Bank-Event'] });
  check(`"${text}"`, r?.action === aktion && r.player === person, JSON.stringify(r));
}

// Alltagssaetze duerfen niemanden ein- oder austragen.
for (const text of [
  'nimm mal die liste',
  'pack schon mal zusammen',
  'trag das bitte nach',
  'ich nehme mir mal frei',
  'nimm es nicht persoenlich',
  'pack es weg',
]) {
  const r = parseIntent(text, { selfId: '9' });
  check(`"${text}" fasst niemanden an`, !r || r.player === '9', JSON.stringify(r));
}

finish();
