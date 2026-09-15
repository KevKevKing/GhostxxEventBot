const { check, equal, finish, section } = require('./lib');
const { entfetten, istAufgeraeumt, nummerAus, nurDerName, zuKanalname } = require('../src/ticket-namen');

// Gemessen an Wegwerf-Kanaelen auf dem echten Server: Discord schreibt jeden
// Kanalnamen klein, macht aus jedem Leerzeichen einen Bindestrich und wirft
// "!", "|" und alle unsichtbaren Zeichen ganz raus. Die mathematischen
// Buchstaben ueberleben, weil sie in Unicode keine Kleinschreibung haben.

const GHOST = '𝗚𝗵𝗼𝘀𝘁·𝗠𝘂𝗳𝗳𝗶𝗶𝗻│266391';

section('Spielernummer finden');
equal('mit Strich', nummerAus('! Ghost Muffiin | 266391'), '266391');
equal('mit I', nummerAus('Dennis Erotica I 142391'), '142391');
// Echter Fall vom Server: Max schreibt gar keinen Trenner, nur zwei Leerzeichen.
equal('ganz ohne Trenner', nummerAus('Max Kok  227216'), '227216');
equal('keine Nummer', nummerAus('Ghost Muffiin'), '');

// Zwei Tickets blieben monatelang unaufgeraeumt, weil der Schraegstrich
// fehlte: "aurelia-aquila-304359" und "timo-hash224608". Die Nummer stand
// klar da, nur der Trenner war ein anderer.
equal('mit Schraegstrich', nummerAus('Aurelia Aquila/304359'), '304359');
equal('  auch ohne Leerzeichen', nummerAus('Timo Hash/224608'), '224608');
equal('  auch mit Leerzeichen drumherum', nummerAus('Rayman Furious / 295271'), '295271');
// Klebt die Zahl direkt am Wort, ist es KEINE Spielernummer - sonst waere
// "Casablanca420" plotzlich Spieler 420.
equal('angeklebte Zahl zaehlt nicht', nummerAus('Casablanca420'), '');

section('Name freilegen');
equal('Zierrat und Nummer weg', nurDerName('! Ghost Muffiin | 266391'), 'Ghost Muffiin');
equal('mit I statt Strich', nurDerName('Fedex Wave I 258761'), 'Fedex Wave');
equal('ohne Leerzeichen am Strich', nurDerName('Danny Imucupancium|156215'), 'Danny Imucupancium');
equal('Herz hinten', nurDerName('Johannes Conti ♡ | 19095'), 'Johannes Conti');
equal('Punkte vorne', nurDerName('...Max Kok | 123456'), 'Max Kok');
equal('ohne Nummer bleibt der Name', nurDerName('Nur Ein Name'), 'Nur Ein Name');

section('Der neue Kanalname');
equal('Ghost', zuKanalname('! Ghost Muffiin | 266391'), GHOST);
equal('Danny', zuKanalname('Danny Imucupancium | 156215'), '𝗗𝗮𝗻𝗻𝘆·𝗜𝗺𝘂𝗰𝘂𝗽𝗮𝗻𝗰𝗶𝘂𝗺│156215');
equal('Fedex', zuKanalname('Fedex Wave I 258761'), '𝗙𝗲𝗱𝗲𝘅·𝗪𝗮𝘃𝗲│258761');
equal('ein Wort', zuKanalname('Chrismo | 4711'), '𝗖𝗵𝗿𝗶𝘀𝗺𝗼│4711');
equal('ohne Trenner', zuKanalname('Max Kok  227216'), '𝗠𝗮𝘅·𝗞𝗼𝗸│227216');
equal('mit Schraegstrich', zuKanalname('Aurelia Aquila/304359'), '𝗔𝘂𝗿𝗲𝗹𝗶𝗮·𝗔𝗾𝘂𝗶𝗹𝗮│304359');
equal('  und ohne Leerzeichen', zuKanalname('Timo Hash/224608'), '𝗧𝗶𝗺𝗼·𝗛𝗮𝘀𝗵│224608');

section('Wann nicht umbenannt wird');
// Ohne Spielernummer haette der Bot hinterher keinen Faden mehr zum Menschen -
// ein huebsches Ticket, das niemandem gehoert, ist schlimmer als ein haessliches.
equal('keine Spielernummer', zuKanalname('Ghost Muffiin'), '');
equal('nur Zierrat', zuKanalname('!!! | 266391'), '');
equal('leer', zuKanalname(''), '');
equal('nichts', zuKanalname(null), '');

section('Zu lang wird hinten gekuerzt');
const lang = zuKanalname(`${'Wilhelmine Reichsgraefin Ottilie Bartholomaeus Friedrich'} | 266391`);
check('passt in 100 Zeichen', lang.length <= 100, `${lang.length}`);
check('Nummer bleibt dran', lang.endsWith('│266391'), lang);
check('faengt vorne an', lang.startsWith('𝗪𝗶𝗹𝗵𝗲𝗹𝗺𝗶𝗻𝗲'), lang);

section('Schon aufgeraeumt?');
check('neuer Name', istAufgeraeumt(GHOST));
check('Ticketbot-Name nicht', !istAufgeraeumt('danny-imucupancium-156215'));
check('frisches Ticket nicht', !istAufgeraeumt('63-ghost_muffin1-ghost_muffin1'));

section('Wieder lesbar machen');
equal('zurueck zu normal', entfetten('𝗚𝗵𝗼𝘀𝘁·𝗠𝘂𝗳𝗳𝗶𝗶𝗻│266391'), 'Ghost·Muffiin│266391');
equal('normaler Text bleibt', entfetten('danny-156215'), 'danny-156215');
equal('leer bleibt leer', entfetten(''), '');

finish();
