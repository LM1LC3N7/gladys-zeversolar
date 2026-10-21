// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. Every text is a { en, fr } object. They never
// quote a text of the inverter (its registry key above all): only our own
// words, error codes and the values we checked.
// -----------------------------------------------------------------------------

const seconds = (ms) => Math.max(1, Math.round(ms / 1000));
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
const hours = (ms) => Math.max(1, Math.round(ms / 3_600_000));
export const delay = (ms) => {
  if (ms >= 2 * 3_600_000) return { en: `${hours(ms)} h`, fr: `${hours(ms)} h` };
  if (ms >= 60_000) return { en: `${minutes(ms)} min`, fr: `${minutes(ms)} min` };
  return { en: `${seconds(ms)} s`, fr: `${seconds(ms)} s` };
};

/** Our words for an error code of src/zeversolar/client.js. */
const REASON = {
  timeout: { en: 'no answer', fr: 'pas de réponse' },
  unreachable: { en: 'unreachable', fr: 'injoignable' },
  http: { en: 'HTTP error', fr: 'erreur HTTP' },
  not_found: {
    en: 'no status page at this address (is it a Zeversolar inverter?)',
    fr: 'pas de page d’état à cette adresse (est-ce bien un onduleur Zeversolar ?)',
  },
  server: { en: 'error of the inverter', fr: 'erreur de l’onduleur' },
  rate_limited: { en: 'too many requests', fr: 'trop de requêtes' },
  too_large: { en: 'answer too large', fr: 'réponse trop grande' },
  unknown_answer: {
    en: 'not the status page of a Zeversolar inverter',
    fr: 'ce n’est pas la page d’état d’un onduleur Zeversolar',
  },
};

export function reason(err) {
  const text = REASON[err?.code] ?? { en: 'unexpected error', fr: 'erreur inattendue' };
  const status =
    (err?.code === 'http' || err?.code === 'server') && Number.isInteger(err.status)
      ? ` ${err.status}`
      : '';
  return { en: `${text.en}${status}`, fr: `${text.fr}${status}` };
}

const kwh = (value) => Math.round(value * 1000) / 1000;

const join = (lang, first, notes) => [first[lang], ...notes.map((n) => n[lang])].join(' ');
const withNotes = (first, notes) => ({
  en: join('en', first, notes),
  fr: join('fr', first, notes),
});

export const T = {
  incomplete: {
    en: 'Enter the address of your Zeversolar inverter (its IP address on your network, e.g. 192.168.1.60).',
    fr: 'Saisissez l’adresse de votre onduleur Zeversolar (son adresse IP sur votre réseau, ex. 192.168.1.60).',
  },
  badAddress: {
    en: 'The inverter address is not valid: enter an IP address or a host name, with an optional port (e.g. 192.168.1.60).',
    fr: 'L’adresse de l’onduleur n’est pas valide : saisissez une adresse IP ou un nom d’hôte, avec un port éventuel (ex. 192.168.1.60).',
  },
  /** `notes`: { en, fr } texts added after the failure (an index held back). */
  unreachable: (address, err, wait, notes = []) =>
    withNotes(
      {
        en: `The Zeversolar inverter at ${address} could not be read (${reason(err).en}): new try in ${delay(wait).en}.`,
        fr: `L’onduleur Zeversolar à l’adresse ${address} n’a pas pu être lu (${reason(err).fr}) : nouvel essai dans ${delay(wait).fr}.`,
      },
      notes,
    ),
  /** HTTP 429 or 5xx: a pause, kept across restarts. */
  paused: (address, err, wait, notes = []) =>
    withNotes(
      {
        en: `The Zeversolar inverter at ${address} asks to wait (${reason(err).en}): reads paused, new try in ${delay(wait).en}.`,
        fr: `L’onduleur Zeversolar à l’adresse ${address} demande d’attendre (${reason(err).fr}) : lectures en pause, nouvel essai dans ${delay(wait).fr}.`,
      },
      notes,
    ),
  /** The night: not an error. `board`: the Wi-Fi board answered without an inverter. */
  asleep: (address, board, notes = []) =>
    withNotes(
      board
        ? {
            en: `The Zeversolar inverter at ${address} is asleep (no sun): its Wi-Fi board answers without production. The values come back when it starts again.`,
            fr: `L’onduleur Zeversolar à l’adresse ${address} est en veille (pas de soleil) : sa carte Wi-Fi répond sans production. Les valeurs reviennent à son redémarrage.`,
          }
        : {
            en: `The Zeversolar inverter at ${address} does not answer: it is asleep (no sun), it goes on at sunrise. If it is daytime, check its address and its Wi-Fi.`,
            fr: `L’onduleur Zeversolar à l’adresse ${address} ne répond pas : il est en veille (pas de soleil), il reprend au lever du soleil. S’il fait jour, vérifiez son adresse et son Wi-Fi.`,
          },
      notes,
    ),
  /** No answer at all for a day: red, even at night. */
  silent: (address, notes = []) =>
    withNotes(
      {
        en: `The Zeversolar inverter at ${address} has given no reading for more than a day: check its address, its Wi-Fi, the inverter itself and its panels (snow?). New try every 5 minutes.`,
        fr: `L’onduleur Zeversolar à l’adresse ${address} n’a donné aucune lecture depuis plus d’un jour : vérifiez son adresse, son Wi-Fi, l’onduleur lui-même et ses panneaux (neige ?). Nouvel essai toutes les 5 minutes.`,
      },
      notes,
    ),
  noDevice: (serial) => ({
    en: `Zeversolar inverter ${serial} found: create its device from the "Discover" tab to receive its values.`,
    fr: `Onduleur Zeversolar ${serial} trouvé : créez son appareil depuis l’onglet « Découverte » pour recevoir ses valeurs.`,
  }),
  waitingSerial: (address) => ({
    en: `Waiting for the first answer of the Zeversolar inverter at ${address} (by day: its serial number gives its device).`,
    fr: `En attente de la première réponse de l’onduleur Zeversolar à l’adresse ${address} (de jour : son numéro de série donne son appareil).`,
  }),
  /** `notes`: { en, fr } texts added after the connection message. */
  ok: (address, notes = []) =>
    withNotes(
      {
        en: `Connected to the Zeversolar inverter (${address}).`,
        fr: `Connecté à l’onduleur Zeversolar (${address}).`,
      },
      notes,
    ),
  notes: {
    noIndex: {
      en: 'The counter of the day made a jump or a drop that is not a new day: no production index until it is back to a plausible value; what is not back is not counted.',
      fr: 'Le compteur du jour a fait un saut ou une baisse qui n’est pas un nouveau jour : pas d’index de production tant qu’il n’est pas revenu à une valeur plausible ; ce qui ne revient pas n’est pas compté.',
    },
    stale: {
      en: 'The inverter still shows the counter of the day before: no production index until it starts the new day.',
      fr: 'L’onduleur affiche encore le compteur de la veille : pas d’index de production tant qu’il n’a pas commencé le nouveau jour.',
    },
    inverters: (count) => ({
      en: `The Wi-Fi board reports ${count} inverters: only the first one is read.`,
      fr: `La carte Wi-Fi signale ${count} onduleurs : seul le premier est lu.`,
    }),
    otherInverter: (serial) => ({
      en: `Another inverter answers at this address (serial ${serial}): its values go to its own device, never to the previous one.`,
      fr: `Un autre onduleur répond à cette adresse (numéro de série ${serial}) : ses valeurs vont à son propre appareil, jamais au précédent.`,
    }),
    held: ({ direction, from, to }) => {
      if (direction === 'down') {
        return {
          en: `The solar production index dropped from ${kwh(from)} to ${kwh(to)} kWh: held back, the last accepted value is sent again. If it is right, click "Accept the held index" in the configuration of the integration: nothing is counted for the drop, the index goes on from there. Saving the configuration accepts nothing.`,
          fr: `L’index de production solaire a baissé de ${kwh(from)} à ${kwh(to)} kWh : retenu, la dernière valeur acceptée est renvoyée. Si c’est juste, cliquez sur « Accepter l’index retenu » dans la configuration de l’intégration : rien n’est compté pour la baisse, l’index repart de là. Enregistrer la configuration n’accepte rien.`,
        };
      }
      const diff = kwh(to - from);
      return {
        en: `The solar production index jumped from ${kwh(from)} to ${kwh(to)} kWh: held back, not sent to the energy monitoring. If you click "Accept the held index" in the configuration of the integration, ${diff} kWh will be counted at once; accept only if this energy was real. Saving the configuration accepts nothing.`,
        fr: `L’index de production solaire a sauté de ${kwh(from)} à ${kwh(to)} kWh : retenu, non envoyé au suivi énergétique. Si vous cliquez sur « Accepter l’index retenu » dans la configuration de l’intégration, ${diff} kWh seront comptés d’un coup ; n’acceptez que si cette énergie est réelle. Enregistrer la configuration n’accepte rien.`,
      };
    },
  },
  accept: {
    nothing: {
      en: 'No index is held back: nothing to accept.',
      fr: 'Aucun index n’est retenu : rien à accepter.',
    },
    done: ({ direction, from, to }) =>
      direction === 'down'
        ? {
            en: `Accepted: the solar production index goes from ${kwh(from)} down to ${kwh(to)} kWh at the next read; 0 kWh is counted for the drop. A different value stays held.`,
            fr: `Accepté : l’index de production solaire passe de ${kwh(from)} à ${kwh(to)} kWh à la prochaine lecture ; 0 kWh est compté pour la baisse. Une autre valeur reste retenue.`,
          }
        : {
            en: `Accepted: the solar production index ${kwh(to)} kWh will be sent at the next read, and ${kwh(to - from)} kWh (plus what comes meanwhile) will be counted at once. A different value stays held.`,
            fr: `Accepté : l’index de production solaire ${kwh(to)} kWh sera envoyé à la prochaine lecture, et ${kwh(to - from)} kWh (plus ce qui vient d’ici là) seront comptés d’un coup. Une autre valeur reste retenue.`,
          },
  },
  test: {
    /** The outcome of a read, `ago` ms ago (0: just now), the next one in `next` ms. */
    reading: ({ serial, hardware, power }, ago, next) => ({
      en: `${ago > 0 ? `Last read ${delay(ago).en} ago` : 'Read now'}: Zeversolar inverter ${serial}${hardware ? ` (board ${hardware})` : ''}, ${power} W.${next > 0 ? ` Next read in ${delay(next).en}.` : ''}`,
      fr: `${ago > 0 ? `Dernière lecture il y a ${delay(ago).fr}` : 'Lu à l’instant'} : onduleur Zeversolar ${serial}${hardware ? ` (carte ${hardware})` : ''}, ${power} W.${next > 0 ? ` Prochaine lecture dans ${delay(next).fr}.` : ''}`,
    }),
    asleep: (ago, next) => ({
      en: `${ago > 0 ? `Last read ${delay(ago).en} ago` : 'Read now'}: the Wi-Fi board of the inverter answers, the inverter is asleep (no sun).${next > 0 ? ` Next read in ${delay(next).en}.` : ''}`,
      fr: `${ago > 0 ? `Dernière lecture il y a ${delay(ago).fr}` : 'Lu à l’instant'} : la carte Wi-Fi de l’onduleur répond, l’onduleur est en veille (pas de soleil).${next > 0 ? ` Prochaine lecture dans ${delay(next).fr}.` : ''}`,
    }),
    failed: (address, err, ago, next) => ({
      en: `${ago > 0 ? `Last read ${delay(ago).en} ago` : 'Read now'}: the inverter at ${address} could not be read (${reason(err).en}). Next read in ${delay(next).en}.`,
      fr: `${ago > 0 ? `Dernière lecture il y a ${delay(ago).fr}` : 'Lu à l’instant'} : l’onduleur à l’adresse ${address} n’a pas pu être lu (${reason(err).fr}). Prochaine lecture dans ${delay(next).fr}.`,
    }),
    notYet: (next) => ({
      en: `No read yet with this configuration: the first one comes in ${delay(next).en} (never more than one a minute).`,
      fr: `Pas encore de lecture avec cette configuration : la première vient dans ${delay(next).fr} (jamais plus d’une par minute).`,
    }),
    slow: {
      en: 'The inverter is slow to answer: look at the integration status in a minute.',
      fr: 'L’onduleur tarde à répondre : regardez l’état de l’intégration dans une minute.',
    },
  },
};
