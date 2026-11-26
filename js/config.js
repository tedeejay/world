/* ═══════════════════════════════════════════════════════════
   CONFIG — edit this file to personalise the app
   ═══════════════════════════════════════════════════════════ */
export const CONFIG = {
  appUrl: 'https://tedeejay.github.io/Jay-Dee/',
  streakNeedsBoth: true,                  // true: both of you must send each day; false: either of you keeps it alive
  streakRestores: 5,                      // restores each person gets in total
  restoreMaxGapDays: 2,                   // longest break that can be restored
  restoreMinStreak: 3,                    // streak must have been at least this long
  restoreWindowDays: 2,                   // how recent the break must be
  /* Tic-tac-toe: symbols each of you can pick from, starting marks, and who moves first */
  ticTacToe: {
    symbols: ['X', 'O', '❤️', '🌹', '⭐', '🔥', '🦋', '🐱'],
    defaults: { jay: 'X', dee: 'O' },
    firstMove: 'alternate'                // 'alternate', or 'jay' / 'dee' to always let one of you start
  },
  togetherSince: '2026-10-03',            // YYYY-MM-DD
  logo: 'https://cdn.dbimg.app/Q7cRoVmy.png',
  lockBg: 'https://cdn.dbimg.app/baOgBUVC.jpg',

  /* Security / sessions */
  passSalt: 'olw-jaydee-v2:',             // changing this means regenerating the hashes below
  idleLockMs: 60 * 1000,                  // lock after this much inactivity
  backgroundLockMs: 5 * 60 * 1000,        // lock if the app was in the background this long
  sessionTtlMs: 6 * 60 * 60 * 1000,       // remembered unlock expires after this
  maxAttempts: 5,                         // wrong codes before a temporary lockout
  lockoutMs: 30 * 1000,                   // base lockout (doubles on repeat, max x8)

  /* Voice notes */
  voiceMaxSeconds: 45,
  voiceMaxBytes: 800 * 1024,              // Firestore docs are capped at 1 MiB

  /* WhatsApp nudge (country code + number, digits only) */
  phones: { jay: '254717478188', dee: '254141375640' },

  birthdays: [
    { name: 'Dee', emoji: '🎂', date: '2007-12-06', glow: '#ff9ec2' },
    { name: 'Jay', emoji: '🎈', date: '2007-05-16', glow: '#a8b8f7' }
  ],

  /* Rooms are keyed by SHA-256(passSalt + passcode). See README → "Change the passcodes". */
  rooms: {
    'e90a5143e56553b04bbf36c01c99a6e91305fda79a156194c651f91bd27e66c2': { id: 'jay', name: 'Jay', partner: 'Dee', emoji: '🎈', welcome: 'Welcome home, Jay' },
    '1f63591ba38d8200e6c89e25a3e2d14f5677e06c5d70c4580e919c96e6f4cce0': { id: 'dee', name: 'Dee', partner: 'Jay', emoji: '🎂', welcome: 'Welcome home, Dee' }
  },

  /* Shown when the Firestore "memories" collection is empty or unreachable */
  fallbackMemories: [
    { type: 'image', url: 'https://cdn.dbimg.app/baOgBUVC.jpg', caption: 'Our memory' },
    { type: 'image', url: 'https://cdn.dbimg.app/0rdl2agw.jpg', caption: 'Another memory' },
    { type: 'video', url: 'https://cdn.dbimg.app/ZdyFCRFo.mp4', caption: 'Video memory' },
    { type: 'video', url: 'https://cdn.dbimg.app/etgrFA9f.mp4', caption: 'Video memory' },
    { type: 'video', url: 'https://cdn.dbimg.app/leqQGz3O.mp4', caption: 'Video memory' },
    { type: 'video', url: 'https://cdn.dbimg.app/gAgAu6k0.mp4', caption: 'Video memory' },
    { type: 'video', url: 'https://cdn.dbimg.app/Nhzanrd5.mp4', caption: 'Video memory' },
    { type: 'video', url: 'https://cdn.dbimg.app/ADmVsVFn.mp4', caption: 'Video memory' },
    { type: 'video', url: 'https://cdn.dbimg.app/zWpVh7BD.mp4', caption: 'Video memory' },
    { type: 'video', url: 'https://cdn.dbimg.app/7lx1xWgA.mp4', caption: 'Video memory' },
    { type: 'video', url: 'https://cdn.dbimg.app/RyPxjPWb.mp4', caption: 'Video memory' }
  ],

  /* Firebase web config (public by design — protect data with Firestore rules) */
  firebase: {
    apiKey: 'AIzaSyBwLwM98bPOurSjd3H4aRFVYpajiuBdGc8',
    authDomain: 'jay-dee-89f72.firebaseapp.com',
    projectId: 'jay-dee-89f72',
    storageBucket: 'jay-dee-89f72.firebasestorage.app',
    messagingSenderId: '221843851378',
    appId: '1:221843851378:web:c041ac58575e35f7101aeb'
  }
};

export const SESSION_KEY = 'olw_session_v2';
