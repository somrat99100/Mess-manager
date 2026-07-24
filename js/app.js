document.getElementById('year').textContent = new Date().getFullYear();

/* ============================================================
   FIREBASE CONFIG
   Replace with your own Firebase project config (Project Settings > General > Your apps).
============================================================ */
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBRvsAWhPGg7FWq5htgDouCjkuvTnSgs9o",
  authDomain: "mess-manager-pro-e3500.firebaseapp.com",
  projectId: "mess-manager-pro-e3500",
  storageBucket: "mess-manager-pro-e3500.firebasestorage.app",
  messagingSenderId: "694751229162",
  appId: "1:694751229162:web:3dbb7052cf48e90bce5393",
  measurementId: "G-2DE8THETRE"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

/* ============================================================
   EMAILJS SETUP (sends the 6-digit OTP code, and email notifications
   for notices / meal-off confirmations / manager confirmations —
   replace these values)
   This all happens entirely from the browser (no backend server
   needed) using EmailJS's free client-side email API.

   To finish wiring this up:
   1. Create a free account at https://www.emailjs.com
   2. Add an "Email Service" (e.g. connect your Gmail) → copy its Service ID.
   3. Create TWO "Email Template"s:
      a) an OTP template whose body includes {{otp_code}}
         (and preferably {{to_name}} / {{to_email}} too) → copy its Template ID.
      b) a general notification template whose body includes {{subject}}
         and {{message}} (and preferably {{to_name}} / {{to_email}}) → copy its Template ID.
   4. Account → General → copy your "Public Key".
   5. Paste all four IDs below. That's it — no server, no secrets in code
      beyond this public key (EmailJS public keys are meant to be client-side).
============================================================ */
const EMAILJS_PUBLIC_KEY    = '7JtKLnzVn99JXMGQO';
const EMAILJS_SERVICE_ID    = 'service_77495rt';
const EMAILJS_TEMPLATE_ID   = 'template_4hhkpa4';        // OTP code template
const EMAILJS_NOTIFY_TEMPLATE_ID = 'template_uuagwk8'; // general notification template
if(typeof emailjs !== 'undefined' && EMAILJS_PUBLIC_KEY !== 'YOUR_EMAILJS_PUBLIC_KEY'){
  emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
}

/* Email notification — used for notices, meal-off confirmations, and manager confirmations.
   Never blocks or breaks the action it's attached to (posting the notice, approving the
   request, etc. always succeeds regardless of email outcome). To make delivery as reliable
   as a client-only app can: if the first attempt fails (network blip, EmailJS hiccup), we
   automatically retry once after a few seconds; if it's still failing after that, we tell
   the person who triggered it — rather than silently dropping it — so they know to follow
   up with that member directly if it matters. */
function sendNotificationEmail(toEmail, toName, subject, message, isRetry){
  if(typeof emailjs === 'undefined' || EMAILJS_PUBLIC_KEY === 'YOUR_EMAILJS_PUBLIC_KEY') return;
  if(!toEmail) return;
  emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_NOTIFY_TEMPLATE_ID, {
    to_email: toEmail, to_name: toName || toEmail, subject, message
  }, EMAILJS_PUBLIC_KEY).catch(e => {
    console.warn('Notification email failed' + (isRetry ? ' (after retry)' : '') + ':', e);
    if(!isRetry){
      setTimeout(()=> sendNotificationEmail(toEmail, toName, subject, message, true), 4000);
    } else {
      toast(`Couldn't email ${toName || toEmail} about "${subject}" — they may not see this update.`, 'err');
    }
  });
}


/* ============================================================
   GLOBAL STATE
============================================================ */
let currentUser = null;       // firebase auth user
let currentUserDoc = null;    // users/{uid}
let currentMessId = null;
let currentMessDoc = null;    // mess/{messId}
let myRole = null;            // 'manager' | 'member'
let messMembers = [];         // array of messMembers docs (with id)
let messMealOffRequests = []; // array of mealOffRequests docs for this mess (with id), all statuses
let messGuestRequests = [];   // array of guestRequests docs for this mess (with id), all statuses
let messManagerRequests = []; // array of managerRequests docs for this mess (with id), all statuses
let messJoinRequests = [];    // array of joinRequests docs for this mess (with id), all statuses
let unsubscribers = [];
let joinReqUnsub = null;              // live listener on this user's own joinRequests, while awaiting approval
let notifiedDeclinedReqIds = new Set(); // join-request ids we've already toasted a decline for (avoid repeat toasts)
let consumedApprovedReqIds = new Set(); // join-request ids we've already reacted to as "approved" (avoid an infinite loop from a stale one)

/* Cached, live-updated data — avoids re-fetching from the network on every render so the
   dashboard, scoreboard, and reports all compute instantly and stay in sync for every viewer. */
let allMealsCache = [];   // every meals/{messId_date} doc for this mess, kept live via one listener
let cachedExpenses = [];  // every expense for this mess, kept live via one listener

/* ---------- utils ---------- */
function toast(msg, type){
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  document.getElementById('toastWrap').appendChild(el);
  setTimeout(()=> el.remove(), 5200);
}
// A Firestore "permission-denied" error on a normal, expected read/write almost always means
// the firestore.rules file in this project hasn't been deployed to the live Firebase project yet
// (editing the file locally has no effect until it's deployed — see SETUP_GUIDE.md, step 2).
// Surface that directly instead of just the raw Firestore error, since the raw message alone
// doesn't tell you what to actually do about it.
function loadErrorMsg(label, e){
  if(e && e.code === 'permission-denied'){
    return `${label}: permission denied — the Firestore rules likely haven't been deployed yet (see SETUP_GUIDE.md, "Deploy the updated Firestore rules").`;
  }
  return `${label}: ${e.message}`;
}
function money(n){ return '৳' + (Number(n)||0).toLocaleString('en-BD', {maximumFractionDigits:2}); }
function setMetric(id, text){
  const el = document.getElementById(id);
  if(!el) return;
  const changed = el.textContent !== String(text);
  el.textContent = text;
  if(changed){
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }
}
function todayStr(){ const d = new Date(); return d.toISOString().slice(0,10); }
function openModal(id){ document.getElementById(id).classList.remove('hidden'); }
function closeModal(id){ document.getElementById(id).classList.add('hidden'); }

// Every modal/sheet (including the mobile "more" sheet opened from the avatar) is a
// .modal-backdrop with a .card/.modal panel inside it. Previously the only way to dismiss any
// of them was to tap a specific in-panel button — tapping the dimmed backdrop around it, or
// pressing Escape, did nothing. That made the mobile "Profile & change mess" sheet in particular
// feel stuck open, with the only tappable options being its menu items (so a mis-tap could land
// on "Log out"). This restores the standard "tap outside to dismiss" and Escape-to-close behavior
// for every modal/sheet in the app, with no changes needed at each individual modal's markup.
document.addEventListener('click', e => {
  if(e.target.classList && e.target.classList.contains('modal-backdrop') && !e.target.classList.contains('hidden')){
    e.target.classList.add('hidden');
  }
});
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach(el => el.classList.add('hidden'));
});

function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function genInviteCode(name){
  const base = (name||'MESS').toUpperCase().replace(/[^A-Z]/g,'').slice(0,4) || 'MESS';
  return base + '-' + Math.floor(1000 + Math.random()*9000);
}

/* ---------- view switching ---------- */
function showHomepage(){
  document.getElementById('homepage').classList.remove('hidden');
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('verifyEmailScreen').classList.add('hidden');
  document.getElementById('appShell').style.display = 'none';
}
function showAuth(mode){
  document.getElementById('homepage').classList.add('hidden');
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('verifyEmailScreen').classList.add('hidden');
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('loginForm').classList.toggle('hidden', mode !== 'login');
  document.getElementById('registerForm').classList.toggle('hidden', mode !== 'register');
  document.getElementById('loginError').classList.add('hidden');
  document.getElementById('registerError').classList.add('hidden');
}
function showApp(){
  document.getElementById('homepage').classList.add('hidden');
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('verifyEmailScreen').classList.add('hidden');
  document.getElementById('appShell').style.display = 'block';
}
function showVerifyEmail(){
  document.getElementById('homepage').classList.add('hidden');
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('verifyEmailScreen').classList.remove('hidden');
  document.getElementById('verifyEmailAddress').textContent = currentUser.email;
  document.getElementById('otpCodeInput').value = '';
  document.getElementById('verifyEmailError').classList.add('hidden');
}

/* ============================================================
   AUTH
============================================================ */
function doRegister(){
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const pass = document.getElementById('regPassword').value;
  const errBox = document.getElementById('registerError');
  errBox.classList.add('hidden');
  if(!name || !email || pass.length < 6){
    errBox.textContent = 'Please fill all fields (password needs 6+ characters).';
    errBox.classList.remove('hidden');
    return;
  }
  auth.createUserWithEmailAndPassword(email, pass)
    .then(cred => db.collection('users').doc(cred.user.uid).set({
      name, email, otpVerified: false, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }))
    .then(()=>{
      // Set this directly (rather than waiting on the async auth-state listener's own fetch) so the
      // OTP email sent next actually greets the person by name instead of falling back to their email.
      currentUserDoc = { name, email, otpVerified: false };
      sendOtpCode();
    })
    // The auth-state listener picks up the new signed-in (but unverified) user and shows
    // the OTP entry screen automatically — nothing else to do here on success.
    .catch(e => { errBox.textContent = e.message; errBox.classList.remove('hidden'); });
}
function doLogin(){
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPassword').value;
  const errBox = document.getElementById('loginError');
  errBox.classList.add('hidden');
  auth.signInWithEmailAndPassword(email, pass)
    .catch(e => { errBox.textContent = e.message; errBox.classList.remove('hidden'); });
}

/* ---------- forgot password: Firebase's own built-in reset-link email ---------- */
function openForgotPasswordModal(){
  document.getElementById('forgotPasswordEmail').value = document.getElementById('loginEmail').value.trim();
  document.getElementById('forgotPasswordError').classList.add('hidden');
  openModal('forgotPasswordModal');
}
function sendPasswordReset(){
  const email = document.getElementById('forgotPasswordEmail').value.trim();
  const errBox = document.getElementById('forgotPasswordError');
  errBox.classList.add('hidden');
  if(!email){
    errBox.textContent = 'Enter your account email first.';
    errBox.classList.remove('hidden');
    return;
  }
  auth.sendPasswordResetEmail(email)
    .then(()=>{
      closeModal('forgotPasswordModal');
      toast('Password reset link sent — check your email', 'ok');
    })
    .catch(e => { errBox.textContent = e.message; errBox.classList.remove('hidden'); });
}
function doLogout(){
  unsubscribers.forEach(u => u());
  unsubscribers = [];
  if(joinReqUnsub){ joinReqUnsub(); joinReqUnsub = null; }
  if(window._scoreboardTicker){ clearInterval(window._scoreboardTicker); window._scoreboardTicker = null; }
  auth.signOut();
}

/* ---------- email OTP verification (post-registration confirmation step) ----------
   The 6-digit code is generated here in the client, stored in /emailOtps/{uid} (readable
   and writable only by that same signed-in user — see firestore.rules), and emailed via
   EmailJS (see the EMAILJS SETUP note near the top of this file). Once the entered code
   matches, we flip our own users/{uid}.otpVerified flag, which is what actually gates
   access to the app (see auth.onAuthStateChanged above). */
function generateOtpCode(){
  return String(Math.floor(100000 + Math.random() * 900000));
}
let lastOtpSentAt = 0;
function sendOtpCode(){
  const user = auth.currentUser;
  if(!user) return;
  const now = Date.now();
  if(now - lastOtpSentAt < 30000){
    toast('Please wait a few seconds before requesting another code.', 'err');
    return;
  }
  if(typeof emailjs === 'undefined' || EMAILJS_PUBLIC_KEY === 'YOUR_EMAILJS_PUBLIC_KEY'){
    toast('Email sending isn\'t configured yet — set EMAILJS_* values in js/app.js.', 'err');
    return;
  }
  const code = generateOtpCode();
  const expiresAt = firebase.firestore.Timestamp.fromDate(new Date(Date.now() + 10 * 60 * 1000));
  db.collection('emailOtps').doc(user.uid).set({
    email: user.email, code, expiresAt, attempts: 0,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(()=> emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
    to_email: user.email,
    to_name: (currentUserDoc && currentUserDoc.name) || user.email,
    otp_code: code
  }, EMAILJS_PUBLIC_KEY)).then(()=>{
    lastOtpSentAt = now;
    toast('Verification code sent — check your email', 'ok');
    const input = document.getElementById('otpCodeInput');
    if(input) input.value = '';
  }).catch(e => toast('Could not send the code: ' + (e && e.text ? e.text : (e.message || e)), 'err'));
}
function verifyOtpCode(){
  const user = auth.currentUser;
  if(!user) return;
  const entered = document.getElementById('otpCodeInput').value.trim();
  const errBox = document.getElementById('verifyEmailError');
  errBox.classList.add('hidden');
  if(!/^\d{6}$/.test(entered)){
    errBox.textContent = 'Enter the 6-digit code from your email.';
    errBox.classList.remove('hidden');
    return;
  }
  const otpRef = db.collection('emailOtps').doc(user.uid);
  otpRef.get().then(doc => {
    if(!doc.exists){
      errBox.textContent = 'No code on file yet — tap "Resend code" below.';
      errBox.classList.remove('hidden');
      return;
    }
    const data = doc.data();
    if(data.expiresAt && data.expiresAt.toDate() < new Date()){
      errBox.textContent = 'That code has expired — tap "Resend code" for a new one.';
      errBox.classList.remove('hidden');
      return;
    }
    if((data.attempts || 0) >= 5){
      errBox.textContent = 'Too many incorrect attempts — tap "Resend code" for a new one.';
      errBox.classList.remove('hidden');
      return;
    }
    if(entered !== data.code){
      otpRef.update({attempts: firebase.firestore.FieldValue.increment(1)});
      errBox.textContent = 'That code is incorrect — please try again.';
      errBox.classList.remove('hidden');
      return;
    }
    return db.collection('users').doc(user.uid).update({otpVerified: true})
      .then(()=> otpRef.delete().catch(()=>{})) // best-effort cleanup; verification already succeeded either way
      .then(()=>{
        currentUserDoc = {...(currentUserDoc || {}), otpVerified: true};
        showApp();
        loadUserAndMess();
      });
  }).catch(e => { errBox.textContent = e.message; errBox.classList.remove('hidden'); });
}

auth.onAuthStateChanged(user => {
  if(user){
    currentUser = user;
    db.collection('users').doc(user.uid).get().then(doc => {
      currentUserDoc = doc.exists ? doc.data() : {name: user.email, email: user.email};
      if(currentUserDoc.otpVerified){
        loadUserAndMess();
      } else {
        showVerifyEmail();
      }
    }).catch(e => toast(e.message, 'err'));
  } else {
    currentUser = null;
    currentUserDoc = null;
    showHomepage();
  }
});

/* ============================================================
   LOAD USER + MESS MEMBERSHIP
============================================================ */
function loadUserAndMess(){
  db.collection('users').doc(currentUser.uid).get().then(doc => {
    currentUserDoc = doc.exists ? doc.data() : {name: currentUser.email, email: currentUser.email};
    document.getElementById('userNameLabel').textContent = currentUserDoc.name;
    document.getElementById('userAvatar').textContent = (currentUserDoc.name||'?').charAt(0).toUpperCase();
    document.getElementById('profName').value = currentUserDoc.name || '';
    document.getElementById('profEmail').value = currentUserDoc.email || currentUser.email;
    // find a messMember doc for this user (a user belongs to one mess in this version)
    return db.collection('messMembers').where('userId','==', currentUser.uid).limit(1).get();
  }).then(snap => {
    showApp();
    if(snap.empty){
      watchMyJoinRequests();
    } else {
      if(joinReqUnsub){ joinReqUnsub(); joinReqUnsub = null; }
      const md = snap.docs[0].data();
      currentMessId = md.messId;
      myRole = md.role;
      attachMessListeners();
      document.getElementById('noMessState').classList.add('hidden');
      document.getElementById('joinPendingState').classList.add('hidden');
      document.getElementById('mainAppState').classList.remove('hidden');
    }
  }).catch(e => toast(e.message, 'err'));
}

/* ---------- while a user has no mess yet: watch for a pending/approved/declined join request ----------
   consumedApprovedReqIds tracks which "approved" requests we've already reacted to. Without it, an
   OLD approved request from a mess the user has since left would look "approved" forever every time
   this listener re-subscribes (e.g. loadUserAndMess() finding no membership calls this again), sending
   loadUserAndMess() → this function → loadUserAndMess() → ... in an infinite loop. Marking an id as
   consumed the first time we act on it means a stale one only ever causes one harmless extra check —
   while a genuinely fresh approval (including one that arrives after a page refresh mid-wait) still
   gets picked up immediately, since its id hasn't been seen before in this session. */
function watchMyJoinRequests(){
  document.getElementById('mainAppState').classList.add('hidden');
  if(joinReqUnsub){ joinReqUnsub(); joinReqUnsub = null; }
  joinReqUnsub = db.collection('joinRequests').where('userId','==', currentUser.uid)
    .onSnapshot(snap => {
      const reqs = snap.docs.map(d => ({id:d.id, ...d.data()}));
      const pending = reqs.find(r => r.status === 'pending');
      const approved = reqs.find(r => r.status === 'approved' && !consumedApprovedReqIds.has(r.id));
      if(pending){
        document.getElementById('noMessState').classList.add('hidden');
        document.getElementById('joinPendingState').classList.remove('hidden');
        document.getElementById('joinPendingMessName').textContent = pending.messName || 'the mess';
      } else if(approved){
        consumedApprovedReqIds.add(approved.id);
        if(joinReqUnsub){ joinReqUnsub(); joinReqUnsub = null; }
        loadUserAndMess();
      } else {
        document.getElementById('joinPendingState').classList.add('hidden');
        document.getElementById('noMessState').classList.remove('hidden');
        const declined = reqs.filter(r => r.status === 'declined')
          .sort((a,b)=> (b.requestedAt ? b.requestedAt.toMillis() : 0) - (a.requestedAt ? a.requestedAt.toMillis() : 0))[0];
        if(declined && !notifiedDeclinedReqIds.has(declined.id)){
          notifiedDeclinedReqIds.add(declined.id);
          toast('Your request to join ' + (declined.messName || 'that mess') + ' was declined.', 'err');
        }
      }
    }, e => toast('Could not check join requests: ' + e.message, 'err'));
}

/* ============================================================
   CREATE / JOIN MESS
============================================================ */
function createMess(){
  const name = document.getElementById('newMessName').value.trim();
  const location = document.getElementById('newMessLocation').value.trim();
  const lunchDeadline = document.getElementById('newMessLunchDeadline').value || '09:00';
  const dinnerDeadline = document.getElementById('newMessDinnerDeadline').value || '16:00';
  if(!name){ toast('Please enter a mess name', 'err'); return; }
  const inviteCode = genInviteCode(name);
  const messRef = db.collection('mess').doc();
  messRef.set({
    name, location, inviteCode, lunchDeadline, dinnerDeadline,
    managerIds: [currentUser.uid],
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(()=> db.collection('messMembers').doc(messRef.id + '_' + currentUser.uid).set({
    messId: messRef.id, userId: currentUser.uid,
    name: currentUserDoc.name, email: currentUserDoc.email,
    role: 'manager', deposit: 0,
    joinedAt: firebase.firestore.FieldValue.serverTimestamp()
  })).then(()=> db.collection('managerHistory').add({
    messId: messRef.id, userId: currentUser.uid, name: currentUserDoc.name,
    startDate: todayStr(), endDate: null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  })).then(()=>{
    closeModal('createMessModal');
    toast('Mess created! Invite code: ' + inviteCode, 'ok');
    currentMessId = messRef.id; myRole = 'manager';
    document.getElementById('noMessState').classList.add('hidden');
    document.getElementById('mainAppState').classList.remove('hidden');
    attachMessListeners();
  }).catch(e => toast(e.message, 'err'));
}

function joinMess(){
  const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
  if(!code){ toast('Enter an invite code', 'err'); return; }
  db.collection('mess').where('inviteCode','==', code).limit(1).get().then(snap => {
    if(snap.empty){ toast('No mess found with that code', 'err'); return; }
    const messDoc = snap.docs[0];
    // Joining now requires the mess's manager to approve — check for an existing pending
    // request first so tapping "Join" twice doesn't create duplicates.
    return db.collection('joinRequests')
      .where('messId','==', messDoc.id)
      .where('userId','==', currentUser.uid)
      .where('status','==','pending')
      .limit(1).get()
      .then(reqSnap => {
        if(!reqSnap.empty){
          closeModal('joinMessModal');
          toast('You already have a pending request to join ' + messDoc.data().name, 'err');
          return;
        }
        return db.collection('joinRequests').add({
          messId: messDoc.id, messName: messDoc.data().name,
          userId: currentUser.uid, name: currentUserDoc.name, email: currentUserDoc.email,
          status: 'pending',
          requestedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(()=>{
          closeModal('joinMessModal');
          toast('Request sent — waiting for the manager of ' + messDoc.data().name + ' to approve', 'ok');
          watchMyJoinRequests();
        });
      });
  }).catch(e => toast(e.message, 'err'));
}

/* ============================================================
   REAL-TIME LISTENERS FOR CURRENT MESS
============================================================ */
function applyRoleUI(){
  const isManager = myRole === 'manager';
  document.querySelectorAll('.manager-only').forEach(el => el.classList.toggle('hidden', !isManager));
  document.getElementById('profRole').textContent = isManager ? 'Manager & Member' : 'Member';
}

function attachMessListeners(){
  applyRoleUI();
  const messSub = db.collection('mess').doc(currentMessId).onSnapshot(doc => {
    currentMessDoc = doc.data();
    document.getElementById('messNameChip').textContent = currentMessDoc.name;
    document.getElementById('profMessName').textContent = currentMessDoc.name;
    document.getElementById('inviteCodeDisplay').textContent = currentMessDoc.inviteCode;
    document.getElementById('setMessName').value = currentMessDoc.name || '';
    document.getElementById('setLocation').value = currentMessDoc.location || '';
    document.getElementById('setPhone').value = currentMessDoc.phone || '';
    document.getElementById('setLunchDeadline').value = currentMessDoc.lunchDeadline || '09:00';
    document.getElementById('setDinnerDeadline').value = currentMessDoc.dinnerDeadline || '16:00';
    document.getElementById('setCycleStart').value = currentMessDoc.cycleStart || '';
    document.getElementById('setCycleEnd').value = currentMessDoc.cycleEnd || '';
    syncDateDisplay('setCycleStart'); syncDateDisplay('setCycleEnd');
    const resetLabel = document.getElementById('resetMessNameLabel');
    if(resetLabel) resetLabel.textContent = currentMessDoc.name || 'this mess';
    renderMealDeadlineNote();
    renderNoticeScoreboard();
    renderCycleMetric();
    generateMonthlyReport();
  }, e => toast(loadErrorMsg('Could not load mess details', e), 'err'));
  unsubscribers.push(messSub);

  const membersSub = db.collection('messMembers').where('messId','==', currentMessId).onSnapshot(snap => {
    messMembers = snap.docs.map(d => ({id: d.id, ...d.data()}));
    // Role can change live (a manager hand-off happening elsewhere) — without this, a demoted
    // manager's own browser kept treating them as manager until their next login, showing
    // controls that Firestore would then reject. Keep myRole in sync with the live data.
    const me = messMembers.find(m => m.userId === currentUser.uid);
    if(me && me.role !== myRole){
      const wasManager = myRole === 'manager';
      myRole = me.role;
      applyRoleUI();
      toast(myRole === 'manager'
        ? 'You are now the manager of this mess'
        : (wasManager ? 'Your manager access has ended — you are now a regular member' : 'Your role was updated'),
        myRole === 'manager' ? 'ok' : 'err');
    }
    renderMemberTable();
    renderDepositSelect();
    loadMealsForDate(document.getElementById('mealDatePicker').value || todayStr());
    renderDashboard();
    renderNoticeScoreboard();
    generateMonthlyReport();
    renderManagerRequestsPanel();
  }, e => toast(loadErrorMsg('Could not load members', e), 'err'));
  unsubscribers.push(membersSub);

  // No orderBy here on purpose — a where() + orderBy() combo needs a manually-created composite
  // Firestore index, and until that index exists the whole listener silently fails. Sorting in the
  // browser instead means expenses always show up right away, index or no index.
  const expSub = db.collection('expenses').where('messId','==', currentMessId).onSnapshot(snap => {
    cachedExpenses = snap.docs.map(d => ({id:d.id, ...d.data({serverTimestamps: 'estimate'})}))
      .sort((a,b) => (b.createdAt ? b.createdAt.toMillis() : 0) - (a.createdAt ? a.createdAt.toMillis() : 0));
    renderExpenseTable(cachedExpenses);
    renderDashboard();
    generateMonthlyReport();
  }, e => toast(loadErrorMsg('Could not load expenses', e), 'err'));
  unsubscribers.push(expSub);

  // Every meal doc for this mess, kept live in one place — the dashboard, scoreboard, and monthly
  // report all read from this cache instead of each doing their own network round trip.
  const allMealsSub = db.collection('meals').where('messId','==', currentMessId).onSnapshot(snap => {
    allMealsCache = snap.docs.map(d => ({id: d.id, ...d.data()}));
    renderDashboard();
    renderNoticeScoreboard();
    generateMonthlyReport();
  }, e => toast(loadErrorMsg('Could not load meal records', e), 'err'));
  unsubscribers.push(allMealsSub);

  const reqSub = db.collection('mealOffRequests').where('messId','==', currentMessId).onSnapshot(snap => {
    messMealOffRequests = snap.docs.map(d => ({id:d.id, ...d.data({serverTimestamps: 'estimate'})}));
    renderRequestsPanel();
    updateMealsTabBadge();
    const dateNow = document.getElementById('mealDatePicker').value || todayStr();
    renderMealCards(dateNow);
  }, e => toast(loadErrorMsg('Could not load meal-off requests', e), 'err'));
  unsubscribers.push(reqSub);

  const guestReqSub = db.collection('guestRequests').where('messId','==', currentMessId).onSnapshot(snap => {
    messGuestRequests = snap.docs.map(d => ({id:d.id, ...d.data({serverTimestamps: 'estimate'})}));
    renderRequestsPanel();
    updateMealsTabBadge();
    const dateNow = document.getElementById('mealDatePicker').value || todayStr();
    renderMealCards(dateNow);
  }, e => toast(loadErrorMsg('Could not load guest requests', e), 'err'));
  unsubscribers.push(guestReqSub);

  // Members asking to become the mess's manager — only the current manager can approve/decline.
  const managerReqSub = db.collection('managerRequests').where('messId','==', currentMessId).onSnapshot(snap => {
    messManagerRequests = snap.docs.map(d => ({id:d.id, ...d.data({serverTimestamps: 'estimate'})}));
    renderManagerRequestsPanel();
    renderMemberTable();
  }, e => toast(loadErrorMsg('Could not load manager requests', e), 'err'));
  unsubscribers.push(managerReqSub);

  // People who've asked to join this mess with the invite code — only the manager can approve/decline.
  const joinReqSub = db.collection('joinRequests').where('messId','==', currentMessId).onSnapshot(snap => {
    messJoinRequests = snap.docs.map(d => ({id:d.id, ...d.data({serverTimestamps: 'estimate'})}));
    renderJoinRequestsPanel();
  }, e => toast(loadErrorMsg('Could not load join requests', e), 'err'));
  unsubscribers.push(joinReqSub);

  // Append-only log of who has managed this mess and for how long.
  const managerHistorySub = db.collection('managerHistory').where('messId','==', currentMessId).onSnapshot(snap => {
    renderManagerHistory(snap.docs.map(d => ({id:d.id, ...d.data()})));
  }, e => toast(loadErrorMsg('Could not load manager history', e), 'err'));
  unsubscribers.push(managerHistorySub);

  const noticeSub = db.collection('notices').where('messId','==', currentMessId).onSnapshot(snap => {
    const notices = snap.docs.map(d => ({id:d.id, ...d.data({serverTimestamps: 'estimate'})}))
      .sort((a,b) => (b.createdAt ? b.createdAt.toMillis() : 0) - (a.createdAt ? a.createdAt.toMillis() : 0))
      .slice(0, 20);
    renderNoticeBoard(notices);
  }, e => toast(loadErrorMsg('Could not load notices', e), 'err'));
  unsubscribers.push(noticeSub);

  if(!document.getElementById('mealDatePicker').value){
    document.getElementById('mealDatePicker').value = todayStr();
  }
  syncDateDisplay('mealDatePicker');
  document.getElementById('mealDatePicker').addEventListener('change', e => { syncDateDisplay('mealDatePicker'); loadMealsForDate(e.target.value); });
  loadMealsForDate(document.getElementById('mealDatePicker').value);

  const reportStartInput = document.getElementById('reportStartDate');
  const reportEndInput = document.getElementById('reportEndDate');
  if(reportStartInput && !reportStartInput.dataset.wired){
    reportStartInput.dataset.wired = '1';
    reportStartInput.addEventListener('change', () => generateMonthlyReport());
  }
  if(reportEndInput && !reportEndInput.dataset.wired){
    reportEndInput.dataset.wired = '1';
    reportEndInput.addEventListener('change', () => generateMonthlyReport());
  }
  generateMonthlyReport();
  renderNoticeScoreboard();

  // The lunch → dinner switchover on the scoreboard is time-based, not event-based —
  // tick it every 30s so it flips the moment the clock crosses the deadline.
  if(!window._scoreboardTicker){
    window._scoreboardTicker = setInterval(renderNoticeScoreboard, 30000);
  }
}

/* ============================================================
   TAB SWITCHING
============================================================ */
function updateMealsTabBadge(){
  const count = myRole === 'manager'
    ? messMealOffRequests.filter(r=>r.status==='pending').length + messGuestRequests.filter(r=>r.status==='pending').length
    : 0;
  [document.getElementById('mealsTabBadge'), document.getElementById('mealsTabBadgeBn')].forEach(badge => {
    if(!badge) return;
    if(myRole !== 'manager'){ badge.classList.add('hidden'); return; }
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  });
}
function switchTab(tab){
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.bn-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'tab-' + tab));
  window.scrollTo({top: 0, behavior: 'smooth'});
}

/* ---------- mobile navigation: homepage hamburger + in-app account sheet ---------- */
function toggleMobileNav(){
  document.getElementById('navMobilePanel').classList.toggle('hidden');
  document.getElementById('navBurgerBtn').classList.toggle('open');
}
function closeMobileNav(){
  document.getElementById('navMobilePanel').classList.add('hidden');
  document.getElementById('navBurgerBtn').classList.remove('open');
}
function openMoreSheet(){
  document.getElementById('moreSheetAvatar').textContent = document.getElementById('userAvatar').textContent;
  document.getElementById('moreSheetName').textContent = currentUserDoc ? currentUserDoc.name : '';
  document.getElementById('moreSheetMess').textContent = currentMessDoc ? currentMessDoc.name : '';
  openModal('moreSheetModal');
}

/* ============================================================
   MEALS
============================================================ */
let currentMealsCache = {}; // memberId -> {lunch,dinner,guest}
let currentDayOff = false;  // whole-day "mess off" switch for the selected date

// A member's meal record is stored as a PARTIAL map in Firestore — only the fields that have
// ever been explicitly written exist there (e.g. after toggling dinner only once, the doc has
// {dinner:false} with no `lunch` key at all). Any field that was never written is meant to
// default to ON (true) / 0 guests. Reading a partial record directly (rec.lunch on a doc that
// only has `dinner`) previously evaluated to `undefined` → falsy → rendered as OFF, which is
// what made turning dinner off look like it had also silently turned lunch off too. Always go
// through this helper so missing fields fall back to their defaults instead of being treated
// as false.
function normalizeMealRec(rec){
  return {
    lunch: (rec && rec.lunch !== undefined) ? !!rec.lunch : true,
    dinner: (rec && rec.dinner !== undefined) ? !!rec.dinner : true,
    guestLunch: Number((rec && rec.guestLunch) || 0),
    guestDinner: Number((rec && rec.guestDinner) || 0)
  };
}

function isBeforeDeadlineFor(dateStr, mealType){
  // members may edit today's or future date's meals only while local time is before that
  // meal's own cutoff, and only for dates that are today or later.
  if(!currentMessDoc) return false;
  const today = todayStr();
  if(dateStr < today) return false; // never edit past dates as a member
  if(dateStr > today) return true;  // future dates always editable pre-deadline
  const field = mealType === 'dinner' ? 'dinnerDeadline' : 'lunchDeadline';
  const fallback = mealType === 'dinner' ? '16:00' : '09:00';
  const [h,m] = (currentMessDoc[field] || fallback).split(':').map(Number);
  const now = new Date();
  const deadline = new Date(); deadline.setHours(h, m, 0, 0);
  return now < deadline;
}

function renderMealDeadlineNote(){
  const dateStr = document.getElementById('mealDatePicker').value || todayStr();
  const note = document.getElementById('deadlineNote');
  if(myRole === 'manager'){
    note.classList.add('hidden');
    return;
  }
  if(currentDayOff){
    note.classList.remove('hidden');
    note.textContent = `🚫 Meals are turned OFF for this day — your manager has switched off cooking today.`;
    return;
  }
  const lunchOpen = isBeforeDeadlineFor(dateStr, 'lunch');
  const dinnerOpen = isBeforeDeadlineFor(dateStr, 'dinner');
  note.classList.remove('hidden');
  const lunchTime = currentMessDoc.lunchDeadline || '09:00';
  const dinnerTime = currentMessDoc.dinnerDeadline || '16:00';
  if(lunchOpen && dinnerOpen){
    note.textContent = `⏰ Lunch closes at ${lunchTime}, dinner closes at ${dinnerTime} today.`;
  } else if(!lunchOpen && dinnerOpen){
    note.textContent = `🔒 Lunch is locked (closed at ${lunchTime}) — send an off-request if you need it changed. Dinner is open until ${dinnerTime}.`;
  } else if(lunchOpen && !dinnerOpen){
    note.textContent = `🔒 Dinner is locked (closed at ${dinnerTime}) — send an off-request if you need it changed. Lunch is open until ${lunchTime}.`;
  } else {
    note.textContent = `🔒 Both lunch (${lunchTime}) and dinner (${dinnerTime}) are locked for today — send an off-request for either one and your manager can approve it.`;
  }
}

let mealDocUnsub = null; // live listener for the currently-viewed date's meals doc
function loadMealsForDate(dateStr){
  if(!currentMessId || !dateStr) return;
  if(mealDocUnsub){ mealDocUnsub(); mealDocUnsub = null; }
  const mealId = currentMessId + '_' + dateStr;
  mealDocUnsub = db.collection('meals').doc(mealId).onSnapshot(doc => {
    const data = doc.exists ? doc.data() : {members: {}, dayOff: false};
    currentMealsCache = data.members || {};
    currentDayOff = !!data.dayOff;
    renderMealCards(dateStr);
    renderMealDeadlineNote();
    renderDayOffSwitch();
    renderDaySummary(dateStr);
  }, e => toast(loadErrorMsg('Could not load meals', e), 'err'));
  unsubscribers.push(mealDocUnsub);
}

function formatDateLabel(dateStr){
  const d = new Date(dateStr + 'T00:00:00');
  if(isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
}

// Native <input type="date"> renders its text in whatever format the device's OS locale uses
// (commonly MM/DD/YYYY on many phones, regardless of the phone's region) — that can't be
// controlled from HTML/CSS. Each date input is paired with a small overlay span
// (id = inputId + 'Display') sitting on top of it that shows a consistent "24-Jul-26" format
// instead; the real input's own text is made transparent via CSS so only our overlay is visible,
// while taps still land on the native input and open its normal picker.
function formatDateShort(dateStr){
  if(!dateStr) return 'Select date';
  const d = new Date(dateStr + 'T00:00:00');
  if(isNaN(d)) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleDateString('en-GB', {month:'short'});
  const year = String(d.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}
function syncDateDisplay(inputId){
  const input = document.getElementById(inputId);
  const label = document.getElementById(inputId + 'Display');
  if(!input || !label) return;
  label.textContent = formatDateShort(input.value);
}
function syncAllDateDisplays(){
  ['mealDatePicker','reportStartDate','reportEndDate','setCycleStart','setCycleEnd'].forEach(syncDateDisplay);
}
// Fires on every user-driven pick (native pickers emit both 'input' and 'change'; either is enough).
['mealDatePicker','reportStartDate','reportEndDate','setCycleStart','setCycleEnd'].forEach(id => {
  const el = document.getElementById(id);
  if(el) el.addEventListener('input', () => syncDateDisplay(id));
});
syncAllDateDisplays();

/* Daily total meal count — colorful summary box at the top of the Meals tab */
function renderDaySummary(dateStr){
  const dateLabelEl = document.getElementById('dayTotalDateLabel');
  if(!dateLabelEl) return; // not on this tab's DOM yet
  dateLabelEl.textContent = formatDateLabel(dateStr) + (dateStr === todayStr() ? ' · today' : '');
  let lunch = 0, dinner = 0, guest = 0, offCount = 0;
  messMembers.forEach(m => {
    const rec = normalizeMealRec(currentMealsCache[m.userId]);
    if(rec.lunch) lunch++; else offCount++;
    if(rec.dinner) dinner++; else offCount++;
    guest += Number(rec.guestLunch || 0) + Number(rec.guestDinner || 0);
  });
  const total = lunch + dinner + guest;
  document.getElementById('dayTotalMeals').innerHTML = total + '<span class="unit">meals</span>';
  document.getElementById('dayTotalLunch').textContent = lunch;
  document.getElementById('dayTotalDinner').textContent = dinner;
  document.getElementById('dayTotalGuest').textContent = guest;
  document.getElementById('dayTotalOff').textContent = offCount;
  document.getElementById('dayOffBanner').classList.toggle('hidden', !currentDayOff);
}

function renderDayOffSwitch(){
  const wrap = document.getElementById('dayOffSwitchWrap');
  if(!wrap) return;
  if(myRole !== 'manager'){ wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  const toggle = document.getElementById('dayOffToggle');
  toggle.classList.toggle('on', !currentDayOff);
  document.getElementById('dayOffLabel').textContent = currentDayOff ? 'Meals OFF for this day' : 'Meals ON for this day';
}

function toggleDayOff(){
  if(myRole !== 'manager') return;
  const dateStr = document.getElementById('mealDatePicker').value || todayStr();
  if(dateStr < todayStr()){ toast('Past days can\u2019t be edited.', 'err'); return; }
  const mealId = currentMessId + '_' + dateStr;
  const newDayOff = !currentDayOff;
  const ref = db.collection('meals').doc(mealId);
  let updatedMembers = currentMealsCache;
  if(newDayOff){
    // switching the whole day off: everyone's lunch & dinner go OFF (guest counts kept as-is)
    updatedMembers = {};
    messMembers.forEach(m => {
      const cur = normalizeMealRec(currentMealsCache[m.userId]);
      updatedMembers[m.userId] = { ...cur, lunch:false, dinner:false };
    });
  }
  ref.set({
    messId: currentMessId, date: dateStr,
    dayOff: newDayOff,
    members: updatedMembers,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: currentUser.uid
  }, {merge: true}).then(()=>{
    renderDashboard();
    toast(newDayOff ? 'Meals switched OFF for this day' : 'Meals switched back ON for this day', 'ok');
  }).catch(e => toast(e.message, 'err'));
}

function renderMealCards(dateStr){
  const wrap = document.getElementById('mealCards');
  if(!wrap) return; // not on this tab's DOM yet
  wrap.innerHTML = '';
  const isManager = myRole === 'manager';
  const isPastDay = dateStr < todayStr();
  const pendingOffForDate = messMealOffRequests.filter(r => r.date === dateStr && r.status === 'pending');
  const pendingGuestForDate = messGuestRequests.filter(r => r.date === dateStr && r.status === 'pending');

  if(!messMembers.length){
    wrap.innerHTML = `<div class="empty-state">No members in this mess yet.</div>`;
    return;
  }

  // Manager is a member too — pin their own row first so their own meals are always front and centre.
  const ordered = [...messMembers].sort((a,b) => {
    if(a.userId === currentUser.uid) return -1;
    if(b.userId === currentUser.uid) return 1;
    return 0;
  });

  ordered.forEach(mem => {
    const rec = normalizeMealRec(currentMealsCache[mem.userId]); // missing fields default to ON, 0 guests
    const gL = Number(rec.guestLunch || 0);
    const gD = Number(rec.guestDinner || 0);
    const isSelf = mem.userId === currentUser.uid;

    // Manager: can edit any day — past, present, or future — at any time, day-off switch included.
    // Member: only their own row, only before that meal's deadline, and never once the day is
    // fully switched off.
    const canEditLunch = isManager
      ? true
      : (isSelf && !currentDayOff && isBeforeDeadlineFor(dateStr, 'lunch'));
    const canEditDinner = isManager
      ? true
      : (isSelf && !currentDayOff && isBeforeDeadlineFor(dateStr, 'dinner'));

    const lunchPending = pendingOffForDate.find(r => r.memberId === mem.userId && r.mealType === 'lunch');
    const dinnerPending = pendingOffForDate.find(r => r.memberId === mem.userId && r.mealType === 'dinner');
    const guestPending = pendingGuestForDate.find(r => r.memberId === mem.userId);

    // Deadline passed but meal is still ON: the member can ask the manager to turn it off.
    // Deadline passed and meal is OFF: the member can ask the manager to turn it back on instead.
    const canRequestLunchOff = !isManager && isSelf && !currentDayOff && !isPastDay && rec.lunch && !canEditLunch && !lunchPending;
    const canRequestLunchOn = !isManager && isSelf && !currentDayOff && !isPastDay && !rec.lunch && !canEditLunch && !lunchPending;
    const canRequestDinnerOff = !isManager && isSelf && !currentDayOff && !isPastDay && rec.dinner && !canEditDinner && !dinnerPending;
    const canRequestDinnerOn = !isManager && isSelf && !currentDayOff && !isPastDay && !rec.dinner && !canEditDinner && !dinnerPending;

    const lunchCell = lunchPending
      ? `<span class="request-pending-badge">${lunchPending.desiredState === true ? 'Turning on' : 'Turning off'}</span>`
      : canRequestLunchOff
        ? `<button class="btn-request-off" onclick="requestMealOff('${dateStr}','lunch',false)">Request off</button>`
        : canRequestLunchOn
          ? `<button class="btn-request-on" onclick="requestMealOff('${dateStr}','lunch',true)">Request on</button>`
          : `<select class="meal-select ${rec.lunch ? 'on':'off'}" ${canEditLunch?'':'disabled'} onchange="setMealState(this,'${dateStr}','${mem.userId}','lunch')">
               <option value="on" ${rec.lunch ? 'selected':''}>ON</option>
               <option value="off" ${!rec.lunch ? 'selected':''}>OFF</option>
             </select>`;

    const dinnerCell = dinnerPending
      ? `<span class="request-pending-badge">${dinnerPending.desiredState === true ? 'Turning on' : 'Turning off'}</span>`
      : canRequestDinnerOff
        ? `<button class="btn-request-off" onclick="requestMealOff('${dateStr}','dinner',false)">Request off</button>`
        : canRequestDinnerOn
          ? `<button class="btn-request-on" onclick="requestMealOff('${dateStr}','dinner',true)">Request on</button>`
          : `<select class="meal-select ${rec.dinner ? 'on':'off'}" ${canEditDinner?'':'disabled'} onchange="setMealState(this,'${dateStr}','${mem.userId}','dinner')">
               <option value="on" ${rec.dinner ? 'selected':''}>ON</option>
               <option value="off" ${!rec.dinner ? 'selected':''}>OFF</option>
             </select>`;

    // Guest meals — manager taps a chip to set that meal's exact count directly; a member taps
    // their own chip to request guest meals be added for lunch or dinner (goes to the manager for approval).
    const guestLunchPending = pendingGuestForDate.find(r => r.memberId === mem.userId && r.mealType === 'lunch');
    const guestDinnerPending = pendingGuestForDate.find(r => r.memberId === mem.userId && r.mealType === 'dinner');
    const canTouchGuest = !currentDayOff && !isPastDay;

    function guestChipFor(mealType, pending, count){
      const icon = mealType === 'lunch' ? '☀️' : '🌙';
      if(pending) return `<span class="request-pending-badge mini">+${pending.count} pending</span>`;
      if(isManager && canTouchGuest){
        return `<button class="guest-chip mini ${count===0?'zero':''}" onclick="openGuestSetModal('${dateStr}','${mem.userId}','${esc(mem.name)}','${mealType}',${count})">${icon} ${count}</button>`;
      }
      if(!isManager && isSelf && canTouchGuest){
        return `<button class="guest-chip mini ${count===0?'zero':''}" onclick="openGuestRequestModal('${dateStr}','${mealType}')">${icon} ${count} <span class="g-plus">+</span></button>`;
      }
      return `<span class="guest-chip mini zero" style="cursor:default;">${icon} ${count}</span>`;
    }
    const guestCell = `<div class="guest-dual">${guestChipFor('lunch', guestLunchPending, gL)}${guestChipFor('dinner', guestDinnerPending, gD)}</div>`;

    const row = document.createElement('div');
    row.className = 'meal-card-row' + (isSelf ? ' mc-self' : '');
    row.innerHTML = `
      <div class="mc-name">${esc(mem.name)} ${isSelf ? '<span class="pill you">You</span>' : ''} ${mem.role==='manager' ? '<span class="pill role">Manager</span>' : ''}</div>
      <div class="mc-col"><span class="mc-col-label">☀️ Lunch</span>${lunchCell}</div>
      <div class="mc-col"><span class="mc-col-label">🌙 Dinner</span>${dinnerCell}</div>
      <div class="mc-col"><span class="mc-col-label">👤 Guest</span>${guestCell}</div>
    `;
    wrap.appendChild(row);
  });
}

/* ---------- meal on/off requests: member asks after the deadline, manager approves/declines ----------
   desiredState=false -> member wants that meal turned OFF (they missed the cutoff while it was on)
   desiredState=true  -> member wants that meal turned back ON (they missed the cutoff while it was off) */
function requestMealOff(dateStr, mealType, desiredState){
  if(myRole === 'manager') return;
  if(dateStr < todayStr()){ toast('Past days can\u2019t be changed.', 'err'); return; }
  const wantsOn = desiredState === true;
  const already = messMealOffRequests.find(r => r.date === dateStr && r.mealType === mealType && r.memberId === currentUser.uid && r.status === 'pending');
  if(already){ toast('You already have a pending request for this meal.', 'err'); return; }
  db.collection('mealOffRequests').add({
    messId: currentMessId, date: dateStr, mealType,
    desiredState: wantsOn,
    memberId: currentUser.uid, memberName: currentUserDoc.name,
    status: 'pending',
    requestedAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(()=> toast(wantsOn ? 'Request to turn this meal back on sent to your manager' : 'Off-request sent to your manager', 'ok'))
    .catch(e => toast(e.message, 'err'));
}

function approveMealOffRequest(reqId){
  if(myRole !== 'manager') return;
  const req = messMealOffRequests.find(r => r.id === reqId);
  if(!req) return;
  const wantsOn = req.desiredState === true;
  const mealId = currentMessId + '_' + req.date;
  db.collection('meals').doc(mealId).set({
    messId: currentMessId, date: req.date,
    members: { [req.memberId]: { [req.mealType]: wantsOn } },
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: currentUser.uid
  }, {merge: true}).then(()=> db.collection('mealOffRequests').doc(reqId).update({
    status: 'approved', respondedAt: firebase.firestore.FieldValue.serverTimestamp(), respondedBy: currentUser.uid
  })).then(()=>{
    toast(`${req.memberName}'s ${req.mealType} marked ${wantsOn ? 'on' : 'off'}`, 'ok');
    renderDashboard();
    const mem = messMembers.find(m => m.userId === req.memberId);
    sendNotificationEmail(mem && mem.email, req.memberName, `Meal-${wantsOn ? 'on' : 'off'} request approved`,
      `Your ${req.mealType} request for ${formatDateLabel(req.date)} has been approved — that meal is now marked ${wantsOn ? 'on' : 'off'}.`);
  }).catch(e => toast(e.message, 'err'));
}

function rejectMealOffRequest(reqId){
  if(myRole !== 'manager') return;
  const req = messMealOffRequests.find(r => r.id === reqId);
  db.collection('mealOffRequests').doc(reqId).update({
    status: 'rejected',
    respondedAt: firebase.firestore.FieldValue.serverTimestamp(),
    respondedBy: currentUser.uid
  }).then(()=>{
    toast('Request declined', 'ok');
    if(req){
      const wantsOn = req.desiredState === true;
      const mem = messMembers.find(m => m.userId === req.memberId);
      sendNotificationEmail(mem && mem.email, req.memberName, `Meal-${wantsOn ? 'on' : 'off'} request declined`,
        `Your ${req.mealType} request (to turn it ${wantsOn ? 'on' : 'off'}) for ${formatDateLabel(req.date)} was declined by your manager.`);
    }
  }).catch(e => toast(e.message, 'err'));
}

/* ---------- guest-meal requests: member asks for guest meals to be added, manager approves/declines ---------- */
let guestRequestDate = null; // set when the "request guest meals" modal opens
function openGuestRequestModal(dateStr, mealType){
  guestRequestDate = dateStr;
  document.getElementById('guestRequestModalSub').textContent = `For ${formatDateLabel(dateStr)}. Your manager will review and approve this.`;
  document.getElementById('guestRequestCount').value = 1;
  if(mealType) document.getElementById('guestRequestMealType').value = mealType;
  openModal('guestRequestModal');
}
function submitGuestRequest(){
  const count = Number(document.getElementById('guestRequestCount').value);
  const mealType = document.getElementById('guestRequestMealType').value;
  if(!guestRequestDate || !count || count <= 0){ toast('Enter how many guest meals you need', 'err'); return; }
  const already = messGuestRequests.find(r => r.date === guestRequestDate && r.mealType === mealType && r.memberId === currentUser.uid && r.status === 'pending');
  if(already){ toast('You already have a pending request for this meal.', 'err'); closeModal('guestRequestModal'); return; }
  db.collection('guestRequests').add({
    messId: currentMessId, date: guestRequestDate, mealType, count,
    memberId: currentUser.uid, memberName: currentUserDoc.name,
    status: 'pending',
    requestedAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(()=>{
    closeModal('guestRequestModal');
    toast('Guest-meal request sent to your manager', 'ok');
  }).catch(e => toast(e.message, 'err'));
}
function approveGuestRequest(reqId){
  if(myRole !== 'manager') return;
  const req = messGuestRequests.find(r => r.id === reqId);
  if(!req) return;
  const mealId = currentMessId + '_' + req.date;
  const field = req.mealType === 'dinner' ? 'guestDinner' : 'guestLunch';
  db.collection('meals').doc(mealId).set({
    messId: currentMessId, date: req.date,
    members: { [req.memberId]: { [field]: firebase.firestore.FieldValue.increment(req.count) } },
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: currentUser.uid
  }, {merge: true}).then(()=> db.collection('guestRequests').doc(reqId).update({
    status: 'approved', respondedAt: firebase.firestore.FieldValue.serverTimestamp(), respondedBy: currentUser.uid
  })).then(()=>{
    toast(`Added ${req.count} ${req.mealType} guest meal(s) for ${req.memberName}`, 'ok');
    renderDashboard();
  }).catch(e => toast(e.message, 'err'));
}
function rejectGuestRequest(reqId){
  if(myRole !== 'manager') return;
  db.collection('guestRequests').doc(reqId).update({
    status: 'rejected',
    respondedAt: firebase.firestore.FieldValue.serverTimestamp(),
    respondedBy: currentUser.uid
  }).then(()=> toast('Request declined', 'ok')).catch(e => toast(e.message, 'err'));
}

/* ---------- manager: set a member's exact guest-meal count directly, any day that isn't past ---------- */
let guestSetContext = null; // {dateStr, memberId, mealType}
function openGuestSetModal(dateStr, memberId, memberName, mealType, currentCount){
  guestSetContext = {dateStr, memberId, mealType};
  const label = mealType === 'dinner' ? '🌙 Dinner' : '☀️ Lunch';
  document.getElementById('guestSetModalTitle').textContent = `Guest meals — ${memberName}`;
  document.getElementById('guestSetModalSub').textContent = `${label} · ${formatDateLabel(dateStr)}`;
  document.getElementById('guestSetCountLabel').textContent = label + ' guest meal count';
  document.getElementById('guestSetCount').value = currentCount;
  openModal('guestSetModal');
}
function submitGuestSet(){
  if(!guestSetContext) return;
  const count = Number(document.getElementById('guestSetCount').value);
  if(isNaN(count) || count < 0){ toast('Enter a valid guest count', 'err'); return; }
  setGuestMeals(guestSetContext.dateStr, guestSetContext.memberId, guestSetContext.mealType, count);
  closeModal('guestSetModal');
}

function renderRequestsPanel(){
  const list = document.getElementById('requestsList');
  if(!list || myRole !== 'manager') return;
  const offPending = messMealOffRequests.filter(r => r.status === 'pending').map(r => ({...r, kind:'off'}));
  const guestPending = messGuestRequests.filter(r => r.status === 'pending').map(r => ({...r, kind:'guest'}));
  const pending = [...offPending, ...guestPending].sort((a,b)=> (a.date||'').localeCompare(b.date||''));
  if(!pending.length){
    list.innerHTML = `<p style="font-size:13px; color:var(--ink-soft);">No pending requests right now.</p>`;
    return;
  }
  list.innerHTML = pending.map(r => {
    const when = r.requestedAt ? timeAgo(r.requestedAt.toDate()) : 'just now';
    if(r.kind === 'off'){
      const wantsOn = r.desiredState === true;
      return `
      <div class="request-row">
        <div class="request-info">
          <span class="request-tag off">${wantsOn ? 'On' : 'Off'}</span><strong>${esc(r.memberName)}</strong> wants ${esc(r.mealType)} ${wantsOn ? 'turned back on' : 'off'} on ${esc(formatDateLabel(r.date))}
          <span class="r-meta">Requested ${when}</span>
        </div>
        <div class="request-actions">
          <button class="btn tiny approve" onclick="approveMealOffRequest('${r.id}')">Approve</button>
          <button class="btn tiny reject" onclick="rejectMealOffRequest('${r.id}')">Decline</button>
        </div>
      </div>`;
    }
    return `
      <div class="request-row">
        <div class="request-info">
          <span class="request-tag guest">Guest</span><strong>${esc(r.memberName)}</strong> wants +${r.count} ${esc(r.mealType||'')} guest meal(s) on ${esc(formatDateLabel(r.date))}
          <span class="r-meta">Requested ${when}</span>
        </div>
        <div class="request-actions">
          <button class="btn tiny approve" onclick="approveGuestRequest('${r.id}')">Approve</button>
          <button class="btn tiny reject" onclick="rejectGuestRequest('${r.id}')">Decline</button>
        </div>
      </div>`;
  }).join('');
}

// Meal ON/OFF is set via a dropdown (<select>) rather than a tap-to-flip switch, so the member
// always picks the exact state they want instead of toggling relative to whatever the UI is
// currently showing — this also sidesteps any stale-cache flicker making it look like the wrong
// meal changed. `selectEl.value` is 'on' or 'off'.
function setMealState(selectEl, dateStr, memberId, type){
  const newVal = selectEl.value === 'on';
  // Manager can edit any date — past, present, or future — at any time.
  const canEdit = myRole === 'manager'
    ? true
    : (!currentDayOff && memberId === currentUser.uid && isBeforeDeadlineFor(dateStr, type));
  if(!canEdit){
    // revert the dropdown to reflect the real current state, then explain why
    const current = normalizeMealRec(currentMealsCache[memberId]);
    selectEl.value = current[type] ? 'on' : 'off';
    if(currentDayOff){ toast('Meals are switched off for this day.', 'err'); return; }
    const label = type === 'dinner' ? 'dinner' : 'lunch';
    toast(`The ${label} deadline has passed — send an off-request instead.`, 'err');
    return;
  }
  const mealId = currentMessId + '_' + dateStr;
  db.collection('meals').doc(mealId).set({
    messId: currentMessId, date: dateStr,
    members: { [memberId]: { [type]: newVal } },
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: currentUser.uid
  }, {merge: true}).then(()=> renderDashboard()).catch(e => toast(e.message, 'err'));
}

// Guest meals: extra meals eaten by a member's guest on a given day, for a specific meal.
// Manager sets the exact count directly (via the guest-set modal); members request additions instead.
function setGuestMeals(dateStr, memberId, mealType, newCount){
  if(myRole !== 'manager'){ toast('Only the manager can set guest meals directly — send a request instead.', 'err'); return; }
  if(dateStr < todayStr()){ toast('Past days can\u2019t be edited.', 'err'); return; }
  if(newCount < 0) newCount = 0;
  const field = mealType === 'dinner' ? 'guestDinner' : 'guestLunch';
  const mealId = currentMessId + '_' + dateStr;
  db.collection('meals').doc(mealId).set({
    messId: currentMessId, date: dateStr,
    members: { [memberId]: { [field]: newCount } },
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: currentUser.uid
  }, {merge: true}).then(()=>{
    renderDashboard();
    toast('Guest meals updated', 'ok');
  }).catch(e => toast(e.message, 'err'));
}

/* ============================================================
   EXPENSES
============================================================ */
function addExpense(){
  const category = document.getElementById('expCategory').value.trim();
  const desc = document.getElementById('expDesc').value.trim();
  const amount = Number(document.getElementById('expAmount').value);
  if(!category || !amount){ toast('Enter a category and amount', 'err'); return; }
  db.collection('expenses').add({
    messId: currentMessId, category, description: desc, amount,
    date: todayStr(), createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    addedBy: currentUser.uid
  }).then(()=>{
    document.getElementById('expCategory').value = '';
    document.getElementById('expDesc').value = '';
    document.getElementById('expAmount').value = '';
    toast('Expense added', 'ok');
  }).catch(e => toast(e.message, 'err'));
}
function deleteExpense(id){
  db.collection('expenses').doc(id).delete().then(()=> toast('Expense removed', 'ok'));
}
function renderExpenseTable(expenses){
  const tbody = document.querySelector('#expenseTable tbody');
  tbody.innerHTML = '';
  if(!expenses.length){
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No expenses logged yet.</div></td></tr>`;
    return;
  }
  expenses.forEach(e => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Date" class="mono">${esc(e.date)}</td>
      <td data-label="Category">${esc(e.category)}</td>
      <td data-label="Description">${esc(e.description||'—')}</td>
      <td data-label="Amount" class="mono">${money(e.amount)}</td>
      <td data-label="" class="manager-only hidden"><button class="btn danger small" onclick="deleteExpense('${e.id}')">Delete</button></td>
    `;
    tbody.appendChild(tr);
  });
  applyRoleUI();
}

/* ============================================================
   MEMBERS TAB
============================================================ */
function renderMemberTable(){
  const tbody = document.querySelector('#memberTable tbody');
  tbody.innerHTML = '';
  messMembers.forEach(mem => {
    const tr = document.createElement('tr');
    const isSelf = mem.userId === currentUser.uid;
    if(isSelf) tr.style.background = 'var(--cream)';
    let actionCell = '';
    if(myRole === 'manager' && !isSelf){
      actionCell = `
        <button class="btn outline small" onclick="promoteMember('${mem.id}','${esc(mem.name)}','${mem.role}')">${mem.role==='manager' ? 'Make member' : 'Make manager'}</button>
        <button class="btn danger small" style="margin-left:6px;" onclick="removeMember('${mem.id}','${esc(mem.name)}')">Remove</button>
      `;
    } else if(isSelf && myRole !== 'manager'){
      const pending = messManagerRequests.find(r => r.memberId === currentUser.uid && r.status === 'pending');
      actionCell = pending
        ? `<span class="request-pending-badge">Awaiting approval</span>`
        : `<button class="btn outline small" onclick="requestToBecomeManager()">Request to be manager</button>`;
    }
    tr.innerHTML = `
      <td data-label="Name">${esc(mem.name)} ${isSelf ? '<span class="pill you">You</span>' : ''}</td>
      <td data-label="Role"><span class="pill role">${mem.role}</span></td>
      <td data-label="Deposit" class="mono">${money(mem.deposit)}</td>
      <td data-label="Actions">${actionCell}</td>
    `;
    tbody.appendChild(tr);
  });
  applyRoleUI();
}
function promoteMember(docId, name, currentRole){
  const newRole = currentRole === 'manager' ? 'member' : 'manager';
  document.getElementById('promoteModalTitle').textContent = newRole === 'manager' ? 'Make manager' : 'Remove manager role';
  document.getElementById('promoteModalBody').textContent = newRole === 'manager'
    ? `There's only ever one manager at a time. ${name} will become the mess's sole manager, gaining full access to edit meals, expenses, and settings for everyone — and the current manager (if different) will immediately lose manager access.`
    : `${name} will become a regular member and lose manager access.`;
  document.getElementById('promoteConfirmBtn').onclick = () => {
    if(newRole === 'manager'){
      const target = messMembers.find(m => m.id === docId);
      if(!target) return;
      transitionManagerTo(target.userId, name)
        .then(()=>{ closeModal('promoteModal'); toast(name + ' is now the manager', 'ok'); })
        .catch(e => toast(e.message, 'err'));
    } else {
      db.collection('messMembers').doc(docId).update({role: newRole})
        .then(()=>{ closeModal('promoteModal'); toast('Role updated', 'ok'); })
        .catch(e => toast(e.message, 'err'));
    }
  };
  openModal('promoteModal');
}

/* ---------- manager: permanently remove a member from the mess ---------- */
function removeMember(docId, name){
  document.getElementById('promoteModalTitle').textContent = 'Remove member';
  document.getElementById('promoteModalBody').textContent =
    `${name} will be permanently removed from this mess and lose access immediately. Their past meal, expense, and deposit records stay for reporting, but they'd need to request to join again to come back.`;
  document.getElementById('promoteConfirmBtn').onclick = () => {
    db.collection('messMembers').doc(docId).delete()
      .then(()=>{ closeModal('promoteModal'); toast(name + ' has been removed from the mess', 'ok'); })
      .catch(e => toast(e.message, 'err'));
  };
  openModal('promoteModal');
}

/* ---------- leave the current mess (from Profile) so a member can join a different one ---------- */
function openLeaveMessModal(){
  if(!currentMessId){ toast('You are not currently in a mess.', 'err'); return; }
  if(myRole === 'manager' && messMembers.length > 1){
    toast('Make another member the manager first (Members tab), then you can leave.', 'err');
    return;
  }
  const messName = currentMessDoc ? currentMessDoc.name : 'this mess';
  document.getElementById('promoteModalTitle').textContent = 'Leave this mess';
  document.getElementById('promoteModalBody').textContent =
    `You'll lose access to ${messName}. Your past meal, expense, and deposit records stay for reporting. You can create or join a different mess right after.`;
  document.getElementById('promoteConfirmBtn').onclick = leaveMess;
  openModal('promoteModal');
}
function leaveMess(){
  const docId = currentMessId + '_' + currentUser.uid;
  db.collection('messMembers').doc(docId).delete()
    .then(()=>{
      closeModal('promoteModal');
      unsubscribers.forEach(u => u());
      unsubscribers = [];
      currentMessId = null; currentMessDoc = null; myRole = null; messMembers = [];
      toast('You have left the mess — create or join a new one below.', 'ok');
      document.getElementById('mainAppState').classList.add('hidden');
      document.getElementById('joinPendingState').classList.add('hidden');
      document.getElementById('noMessState').classList.remove('hidden');
    })
    .catch(e => toast(e.message, 'err'));
}

/* ============================================================
   MANAGER HAND-OFF — there is only ever one manager at a time.
   Used both when the current manager directly promotes someone, and
   when the manager approves another member's "become manager" request.
   Runs as a single atomic batch so every write (including the outgoing
   manager demoting themselves) is authorized against their still-current
   'manager' role at the moment the batch is evaluated.
============================================================ */
function transitionManagerTo(newManagerUserId, newManagerName){
  const today = todayStr();
  return db.collection('managerHistory')
    .where('messId','==', currentMessId)
    .where('endDate','==', null)
    .get()
    .then(openSnap => {
      const batch = db.batch();
      messMembers.forEach(m => {
        if(m.role === 'manager' && m.userId !== newManagerUserId){
          batch.update(db.collection('messMembers').doc(m.id), {role: 'member'});
        }
      });
      const target = messMembers.find(m => m.userId === newManagerUserId);
      if(target) batch.update(db.collection('messMembers').doc(target.id), {role: 'manager'});
      batch.update(db.collection('mess').doc(currentMessId), {managerIds: [newManagerUserId]});

      let alreadyOpenForNew = false;
      openSnap.docs.forEach(d => {
        if(d.data().userId === newManagerUserId) alreadyOpenForNew = true;
        else batch.update(d.ref, {endDate: today});
      });
      if(!alreadyOpenForNew){
        batch.set(db.collection('managerHistory').doc(), {
          messId: currentMessId, userId: newManagerUserId, name: newManagerName,
          startDate: today, endDate: null,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
      return batch.commit();
    });
}

/* ---------- "become manager" requests: any member can ask, only the current manager decides ---------- */
function requestToBecomeManager(){
  if(myRole === 'manager') return;
  const already = messManagerRequests.find(r => r.memberId === currentUser.uid && r.status === 'pending');
  if(already){ toast('You already have a pending request.', 'err'); return; }
  db.collection('managerRequests').add({
    messId: currentMessId, memberId: currentUser.uid, memberName: currentUserDoc.name,
    status: 'pending',
    requestedAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(()=> toast('Request sent to the current manager', 'ok'))
    .catch(e => toast(e.message, 'err'));
}
function approveManagerRequest(reqId){
  if(myRole !== 'manager') return;
  const req = messManagerRequests.find(r => r.id === reqId);
  if(!req) return;
  transitionManagerTo(req.memberId, req.memberName)
    .then(()=> db.collection('managerRequests').doc(reqId).update({
      status: 'approved', respondedAt: firebase.firestore.FieldValue.serverTimestamp(), respondedBy: currentUser.uid
    }))
    .then(()=>{
      toast(req.memberName + ' is now the manager', 'ok');
      const mem = messMembers.find(m => m.userId === req.memberId);
      const messName = currentMessDoc ? currentMessDoc.name : 'your mess';
      sendNotificationEmail(mem && mem.email, req.memberName, 'You are now the manager',
        `Your request to become the manager of ${messName} has been approved — you now have full manager access.`);
    })
    .catch(e => toast(e.message, 'err'));
}
function rejectManagerRequest(reqId){
  if(myRole !== 'manager') return;
  const req = messManagerRequests.find(r => r.id === reqId);
  db.collection('managerRequests').doc(reqId).update({
    status: 'rejected',
    respondedAt: firebase.firestore.FieldValue.serverTimestamp(),
    respondedBy: currentUser.uid
  }).then(()=>{
    toast('Request declined', 'ok');
    if(req){
      const mem = messMembers.find(m => m.userId === req.memberId);
      const messName = currentMessDoc ? currentMessDoc.name : 'your mess';
      sendNotificationEmail(mem && mem.email, req.memberName, 'Manager request declined',
        `Your request to become the manager of ${messName} was declined.`);
    }
  }).catch(e => toast(e.message, 'err'));
}
function renderManagerRequestsPanel(){
  const list = document.getElementById('managerRequestsList');
  if(!list || myRole !== 'manager') return;
  const pending = messManagerRequests.filter(r => r.status === 'pending');
  if(!pending.length){
    list.innerHTML = `<p style="font-size:13px; color:var(--ink-soft);">No pending manager requests right now.</p>`;
    return;
  }
  list.innerHTML = pending.map(r => {
    const when = r.requestedAt ? timeAgo(r.requestedAt.toDate()) : 'just now';
    return `
      <div class="request-row">
        <div class="request-info">
          <span class="request-tag guest">Manager</span><strong>${esc(r.memberName)}</strong> wants to become the manager
          <span class="r-meta">Requested ${when}</span>
        </div>
        <div class="request-actions">
          <button class="btn tiny approve" onclick="approveManagerRequest('${r.id}')">Approve</button>
          <button class="btn tiny reject" onclick="rejectManagerRequest('${r.id}')">Decline</button>
        </div>
      </div>`;
  }).join('');
}

/* ---------- join requests: anyone with the invite code asks to join, only the manager decides ---------- */
function approveJoinRequest(reqId){
  if(myRole !== 'manager') return;
  const req = messJoinRequests.find(r => r.id === reqId);
  if(!req) return;
  const batch = db.batch();
  batch.set(db.collection('messMembers').doc(currentMessId + '_' + req.userId), {
    messId: currentMessId, userId: req.userId,
    name: req.name, email: req.email,
    role: 'member', deposit: 0,
    joinedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  batch.update(db.collection('joinRequests').doc(reqId), {
    status: 'approved', respondedAt: firebase.firestore.FieldValue.serverTimestamp(), respondedBy: currentUser.uid
  });
  batch.commit()
    .then(()=> toast(req.name + ' has joined the mess', 'ok'))
    .catch(e => toast(e.message, 'err'));
}
function declineJoinRequest(reqId){
  if(myRole !== 'manager') return;
  db.collection('joinRequests').doc(reqId).update({
    status: 'declined',
    respondedAt: firebase.firestore.FieldValue.serverTimestamp(),
    respondedBy: currentUser.uid
  }).then(()=> toast('Request declined', 'ok')).catch(e => toast(e.message, 'err'));
}
function renderJoinRequestsPanel(){
  const list = document.getElementById('joinRequestsList');
  if(!list || myRole !== 'manager') return;
  const pending = messJoinRequests.filter(r => r.status === 'pending');
  if(!pending.length){
    list.innerHTML = `<p style="font-size:13px; color:var(--ink-soft);">No pending join requests right now.</p>`;
    return;
  }
  list.innerHTML = pending.map(r => {
    const when = r.requestedAt ? timeAgo(r.requestedAt.toDate()) : 'just now';
    return `
      <div class="request-row">
        <div class="request-info">
          <span class="request-tag guest">Join</span><strong>${esc(r.name)}</strong> wants to join this mess
          <span class="r-meta">Requested ${when}${r.email ? ' · ' + esc(r.email) : ''}</span>
        </div>
        <div class="request-actions">
          <button class="btn tiny approve" onclick="approveJoinRequest('${r.id}')">Approve</button>
          <button class="btn tiny reject" onclick="declineJoinRequest('${r.id}')">Decline</button>
        </div>
      </div>`;
  }).join('');
}

/* ---------- manager history: who has run this mess, and for how long ---------- */
function renderManagerHistory(history){
  const wrap = document.getElementById('managerHistoryList');
  if(!wrap) return;
  if(!history.length){
    wrap.innerHTML = `<p style="font-size:13px; color:var(--ink-soft);">No manager history yet — this starts logging from the mess's first manager hand-off.</p>`;
    return;
  }
  const sorted = [...history].sort((a,b) => (a.startDate||'').localeCompare(b.startDate||''));
  wrap.innerHTML = sorted.map((h, i) => `
    <div class="manager-history-row">
      <span class="mh-index">${i+1}.</span>
      <span class="mh-name">${esc(h.name)}</span>
      <span class="mh-range mono">${formatDateLabel(h.startDate)} → ${h.endDate ? formatDateLabel(h.endDate) : 'Present'}</span>
      ${!h.endDate ? '<span class="pill on">Current</span>' : ''}
    </div>
  `).join('');
}

function renderDepositSelect(){
  const sel = document.getElementById('depositMemberSelect');
  const prevValue = sel.value;
  sel.innerHTML = messMembers.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  if(prevValue && messMembers.some(m => m.id === prevValue)) sel.value = prevValue;
  updateCurrentDepositHint();
}
function updateCurrentDepositHint(){
  const hint = document.getElementById('currentDepositHint');
  if(!hint) return;
  const docId = document.getElementById('depositMemberSelect').value;
  const mem = messMembers.find(m => m.id === docId);
  hint.textContent = mem ? `Current deposit: ${money(mem.deposit)}` : '';
}
// Adds to a member's running deposit total (atomic increment) so repeated top-ups
// throughout the month always accumulate correctly instead of silently overwriting each other.
function addFund(){
  const docId = document.getElementById('depositMemberSelect').value;
  const amount = Number(document.getElementById('depositAmount').value);
  if(!docId || !amount || amount <= 0){ toast('Choose a member and enter a positive amount', 'err'); return; }
  db.collection('messMembers').doc(docId).update({
    deposit: firebase.firestore.FieldValue.increment(amount)
  }).then(()=>{
    document.getElementById('depositAmount').value = '';
    toast('Fund added — dashboard updated', 'ok');
  }).catch(e => toast(e.message, 'err'));
}
/* ============================================================
   SETTINGS
============================================================ */
function saveMessSettings(){
  db.collection('mess').doc(currentMessId).update({
    name: document.getElementById('setMessName').value.trim(),
    location: document.getElementById('setLocation').value.trim(),
    phone: document.getElementById('setPhone').value.trim(),
    lunchDeadline: document.getElementById('setLunchDeadline').value || '09:00',
    dinnerDeadline: document.getElementById('setDinnerDeadline').value || '16:00',
    cycleStart: document.getElementById('setCycleStart').value || '',
    cycleEnd: document.getElementById('setCycleEnd').value || ''
  }).then(()=> toast('Mess settings saved', 'ok')).catch(e => toast(e.message,'err'));
}

/* ============================================================
   DANGER ZONE — a freshly-assigned manager can wipe the slate clean:
   every meal record, expense, notice, and pending request gets deleted,
   and every member's deposit resets to ৳0. Members and the invite code
   are left untouched.
============================================================ */
function openResetDataModal(){
  if(myRole !== 'manager') return;
  document.getElementById('resetConfirmInput').value = '';
  openModal('resetDataModal');
}
function confirmResetAllData(){
  if(myRole !== 'manager' || !currentMessDoc) return;
  const typed = document.getElementById('resetConfirmInput').value.trim();
  if(typed !== currentMessDoc.name){
    toast('Mess name doesn\u2019t match — type it exactly to confirm.', 'err');
    return;
  }
  toast('Resetting mess data…', 'ok');
  const collections = ['meals', 'expenses', 'notices', 'mealOffRequests', 'guestRequests'];
  Promise.all(collections.map(col => db.collection(col).where('messId','==', currentMessId).get()))
    .then(snaps => {
      const allRefs = snaps.flatMap(snap => snap.docs.map(d => d.ref));
      // Firestore batches cap at 500 writes — chunk in case a mess has a long history.
      const chunks = [];
      for(let i = 0; i < allRefs.length; i += 450) chunks.push(allRefs.slice(i, i + 450));
      return chunks.reduce((p, chunk) => p.then(() => {
        const batch = db.batch();
        chunk.forEach(ref => batch.delete(ref));
        return batch.commit();
      }), Promise.resolve());
    })
    .then(() => {
      const chunks = [];
      for(let i = 0; i < messMembers.length; i += 450) chunks.push(messMembers.slice(i, i + 450));
      return chunks.reduce((p, chunk) => p.then(() => {
        const batch = db.batch();
        chunk.forEach(m => batch.update(db.collection('messMembers').doc(m.id), {deposit: 0}));
        return batch.commit();
      }), Promise.resolve());
    })
    .then(() => {
      closeModal('resetDataModal');
      toast('Mess data reset — fresh start!', 'ok');
    })
    .catch(e => toast(e.message, 'err'));
}

/* ============================================================
   PROFILE
============================================================ */
function saveProfile(){
  const name = document.getElementById('profName').value.trim();
  if(!name){ toast('Name cannot be empty','err'); return; }
  db.collection('users').doc(currentUser.uid).update({name}).then(()=>{
    // also update messMembers name copy for this mess
    const mine = messMembers.find(m => m.userId === currentUser.uid);
    if(mine) db.collection('messMembers').doc(mine.id).update({name});
    document.getElementById('userNameLabel').textContent = name;
    document.getElementById('userAvatar').textContent = name.charAt(0).toUpperCase();
    toast('Profile updated', 'ok');
  }).catch(e => toast(e.message,'err'));
}

/* ============================================================
   NOTICE BOARD — any member can post, shown big on the dashboard
============================================================ */
function timeAgo(date){
  if(!date) return '';
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if(mins < 1) return 'just now';
  if(mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if(hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  return days + 'd ago';
}
function formatDateTime(date){
  if(!date) return '';
  return date.toLocaleString('en-GB', {day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'});
}

let latestNotices = []; // cached for the "see all" modal

function renderNoticeBoard(notices){
  latestNotices = notices;
  const mainText = document.getElementById('noticeMainText');
  const mainMeta = document.getElementById('noticeMainMeta');
  const historyWrap = document.getElementById('noticeHistoryWrap');
  const historyList = document.getElementById('noticeHistoryList');
  const seeAllBtn = document.getElementById('seeAllNoticesBtn');

  if(!notices.length){
    mainText.textContent = 'No notices yet — be the first to post one.';
    mainMeta.textContent = '';
    historyWrap.classList.add('hidden');
    seeAllBtn.classList.add('hidden');
    return;
  }
  const latest = notices[0];
  const latestDate = latest.createdAt ? latest.createdAt.toDate() : new Date();
  mainText.textContent = '“' + latest.text + '”';
  mainMeta.textContent = '— ' + latest.authorName + ' · ' + formatDateTime(latestDate) + ' (' + timeAgo(latestDate) + ')';

  const rest = notices.slice(1, 4); // last 3 only — full list lives behind "See all"
  if(rest.length){
    historyWrap.classList.remove('hidden');
    historyList.innerHTML = rest.map(n => noticeItemHtml(n)).join('');
  } else {
    historyWrap.classList.add('hidden');
  }
  seeAllBtn.classList.toggle('hidden', notices.length <= 4);
}
function noticeItemHtml(n){
  const d = n.createdAt ? n.createdAt.toDate() : null;
  return `<div class="notice-item"><span>${esc(n.text)} — <em>${esc(n.authorName)}</em></span><span class="n-meta">${d ? formatDateTime(d) : timeAgo(d)}</span></div>`;
}
function openAllNoticesModal(){
  document.getElementById('allNoticesList').innerHTML = latestNotices.map(n => noticeItemHtml(n)).join('');
  openModal('allNoticesModal');
}

function postNotice(){
  const text = document.getElementById('noticeTextInput').value.trim();
  if(!text){ toast('Write something before posting', 'err'); return; }
  db.collection('notices').add({
    messId: currentMessId,
    authorId: currentUser.uid,
    authorName: currentUserDoc.name,
    text,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(()=>{
    document.getElementById('noticeTextInput').value = '';
    closeModal('postNoticeModal');
    toast('Notice posted', 'ok');
    const messName = currentMessDoc ? currentMessDoc.name : 'your mess';
    messMembers.forEach(m => {
      if(m.userId === currentUser.uid) return; // don't email the author their own notice
      sendNotificationEmail(m.email, m.name, `New notice in ${messName}`,
        `${currentUserDoc.name} posted a notice in ${messName}:\n\n"${text}"`);
    });
  }).catch(e => toast(e.message, 'err'));
}

/* ============================================================
   LIVE SCOREBOARD — today's total Lunch, then today's total Dinner
   once the lunch cutoff has passed. Reads straight from allMealsCache,
   so it updates the instant anyone's meal changes.
============================================================ */
function currentMealPhase(){
  if(!currentMessDoc) return 'lunch';
  const [h,m] = (currentMessDoc.lunchDeadline || '09:00').split(':').map(Number);
  const deadline = new Date(); deadline.setHours(h, m, 0, 0);
  return new Date() < deadline ? 'lunch' : 'dinner';
}
function renderNoticeScoreboard(){
  const countEl = document.getElementById('scoreboardCount');
  if(!countEl || !currentMessId) return;
  const phase = currentMealPhase();
  const today = todayStr();
  const todayDoc = allMealsCache.find(d => d.date === today);
  const members = (todayDoc && todayDoc.members) || {};
  let count = 0;
  messMembers.forEach(m => {
    const rec = normalizeMealRec(members[m.userId]);
    if(phase === 'lunch') count += (rec.lunch ? 1 : 0) + rec.guestLunch;
    else count += (rec.dinner ? 1 : 0) + rec.guestDinner;
  });
  countEl.textContent = count;
  document.getElementById('scoreboardIcon').textContent = phase === 'lunch' ? '☀️' : '🌙';
  document.getElementById('scoreboardLabel').textContent = phase === 'lunch' ? "Today's total Lunch" : "Today's total Dinner";
}

/* ============================================================
   DASHBOARD CALCULATIONS
============================================================ */
/* Tallies lunch/dinner (each including that meal's guest count) for every member across a
   given set of meal docs. Shared by the live dashboard and the monthly report. */
function tallyMeals(mealDocs){
  const perMember = {}; // userId -> {lunch, dinner, total}
  messMembers.forEach(m => perMember[m.userId] = {lunch:0, dinner:0, total:0});
  let totalMeals = 0;
  mealDocs.forEach(doc => {
    const members = doc.members || {};
    Object.keys(members).forEach(uid => {
      if(!perMember[uid]) perMember[uid] = {lunch:0, dinner:0, total:0};
      const rec = normalizeMealRec(members[uid]);
      const lunch = (rec.lunch ? 1 : 0) + rec.guestLunch;
      const dinner = (rec.dinner ? 1 : 0) + rec.guestDinner;
      perMember[uid].lunch += lunch;
      perMember[uid].dinner += dinner;
      perMember[uid].total += lunch + dinner;
      totalMeals += lunch + dinner;
    });
  });
  return {perMember, totalMeals};
}

// Computes and paints the live dashboard synchronously from the already-live caches
// (allMealsCache, cachedExpenses, messMembers) — no network call happens on render,
// so the numbers update the instant any listener fires.
function renderDashboard(){
  if(!currentMessId) return;
  const totalExpense = cachedExpenses.reduce((s,e)=> s + Number(e.amount||0), 0);
  const {perMember, totalMeals} = tallyMeals(allMealsCache);
  const totalDeposit = messMembers.reduce((s,m)=> s + Number(m.deposit||0), 0);
  const mealRate = totalMeals > 0 ? totalExpense / totalMeals : 0;
  const fund = totalDeposit - totalExpense;

  setMetric('mTotalCollection', money(totalDeposit));
  setMetric('mTotalExpense', money(totalExpense));
  setMetric('mTotalMeals', totalMeals);
  setMetric('allTimeTotalMeals', totalMeals);
  setMetric('mMealRate', money(mealRate.toFixed(2)));
  setMetric('mFund', money(fund));
  // Three-tier fund health: Negative (in deficit), Low (positive but thin — couldn't
  // comfortably cover a few more days of meals for everyone), Healthy (solid buffer).
  const statusEl = document.getElementById('mStatus');
  if(statusEl){
    const activeMembers = messMembers.length || 1;
    const lowBuffer = mealRate > 0 ? mealRate * activeMembers * 3 : 500; // ~3 more days of meals, all members
    let statusText, statusColor;
    if(fund < 0){ statusText = '🔴 Negative'; statusColor = 'var(--bad)'; }
    else if(fund < lowBuffer){ statusText = '🟡 Low'; statusColor = 'var(--gold)'; }
    else { statusText = '🟢 Healthy'; statusColor = 'var(--good)'; }
    statusEl.textContent = statusText;
    statusEl.style.color = statusColor;
  }
  renderCycleMetric();

  let myBalance = 0;
  const rows = messMembers.map(m => {
    const mCounts = perMember[m.userId] || {lunch:0, dinner:0, total:0};
    const cost = mCounts.total * mealRate;
    const bal = Number(m.deposit||0) - cost;
    if(m.userId === currentUser.uid) myBalance = bal;
    return {m, mCounts, cost, bal};
  });
  renderBalanceGlanceTable(rows);
  setMetric('mMyBalance', money(myBalance.toFixed(2)));
}

function renderCycleMetric(){
  const el = document.getElementById('mCycle');
  if(!el || !currentMessDoc) return;
  const s = currentMessDoc.cycleStart, e = currentMessDoc.cycleEnd;
  if(!s && !e){
    el.innerHTML = `<span class="cycle-empty">Not set</span>`;
    return;
  }
  el.innerHTML = `<span>${s ? formatDateLabel(s) : '—'}</span><span class="cycle-sep">to</span><span>${e ? formatDateLabel(e) : '—'}</span>`;
}

function renderBalanceGlanceTable(rows){
  const tbody = document.querySelector('#dashboardMemberTable tbody');
  if(!tbody) return;
  tbody.innerHTML = '';
  if(!rows.length){
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">No members yet.</div></td></tr>`;
    return;
  }
  rows.forEach(({m, mCounts, cost, bal}) => {
    const isSelf = m.userId === currentUser.uid;
    const tr = document.createElement('tr');
    if(isSelf) tr.style.background = 'var(--cream)';
    tr.innerHTML = `
      <td data-label="Member">${esc(m.name)} ${isSelf ? '<span class="pill you">You</span>' : ''}</td>
      <td data-label="Deposit" class="mono">${money(m.deposit)}</td>
      <td data-label="☀️ Lunch" class="mono">${mCounts.lunch}</td>
      <td data-label="🌙 Dinner" class="mono">${mCounts.dinner}</td>
      <td data-label="Total meals" class="mono">${mCounts.total}</td>
      <td data-label="Cost" class="mono">${money(cost.toFixed(2))}</td>
      <td data-label="Balance" class="mono">${money(bal.toFixed(2))}</td>
      <td data-label="Status"><span class="pill ${bal>=0?'on':'off'}">${bal>=0 ? 'No due' : 'Due'}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

/* ============================================================
   MONTHLY / CYCLE REPORT — mirrors the dashboard math but scoped to a
   date range, clamped to the mess's current manager cycle (if one is
   set), with a Download as PDF / JPG option.
   Managers see and download every member's row together; a regular
   member only ever sees and downloads their own row.
============================================================ */
// Keeps the report's start/end date inputs within the current mess cycle (if the
// manager has set one) and fills in sensible defaults the first time they're empty.
function initReportRangeInputs(){
  const startInput = document.getElementById('reportStartDate');
  const endInput = document.getElementById('reportEndDate');
  if(!startInput || !endInput) return;
  const cycleStart = currentMessDoc && currentMessDoc.cycleStart;
  const cycleEnd = currentMessDoc && currentMessDoc.cycleEnd;

  startInput.min = cycleStart || '';
  startInput.max = cycleEnd || '';
  endInput.min = cycleStart || '';
  endInput.max = cycleEnd || '';

  if(!startInput.value) startInput.value = cycleStart || todayStr().slice(0,8) + '01';
  if(!endInput.value) endInput.value = cycleEnd || todayStr();

  // If a cycle is set, clamp any out-of-range value back inside it (e.g. after a manager
  // hand-off shrinks the active cycle).
  if(cycleStart && startInput.value < cycleStart) startInput.value = cycleStart;
  if(cycleEnd && startInput.value > cycleEnd) startInput.value = cycleEnd;
  if(cycleStart && endInput.value < cycleStart) endInput.value = cycleStart;
  if(cycleEnd && endInput.value > cycleEnd) endInput.value = cycleEnd;

  const hintEl = document.getElementById('reportRangeHint');
  if(hintEl){
    hintEl.textContent = (cycleStart || cycleEnd)
      ? `📅 Limited to the current mess cycle: ${cycleStart ? formatDateLabel(cycleStart) : '—'} to ${cycleEnd ? formatDateLabel(cycleEnd) : '—'}.`
      : `📅 No mess cycle set yet — the manager can set one in Settings to limit report dates.`;
  }
  syncDateDisplay('reportStartDate'); syncDateDisplay('reportEndDate');
}

function generateMonthlyReport(){
  const table = document.getElementById('monthlyReportTable');
  if(!table || !currentMessId) return;
  initReportRangeInputs();

  const startInput = document.getElementById('reportStartDate');
  const endInput = document.getElementById('reportEndDate');
  let startStr = (startInput && startInput.value) || todayStr().slice(0,8) + '01';
  let endStr = (endInput && endInput.value) || todayStr();
  if(startStr > endStr){ const tmp = startStr; startStr = endStr; endStr = tmp; }

  const titleEl = document.getElementById('reportBannerTitle');
  const isManager = myRole === 'manager';
  if(titleEl){
    titleEl.textContent = `${isManager ? 'Mess Report' : 'My Report'} — ${formatDateLabel(startStr)} to ${formatDateLabel(endStr)}`;
  }
  const panelTitleEl = document.getElementById('reportPanelTitle');
  if(panelTitleEl){
    panelTitleEl.textContent = isManager ? '📄 Monthly report — all members' : '📄 My monthly report';
  }

  const rangeMeals = allMealsCache.filter(d => d.date && d.date >= startStr && d.date <= endStr);
  const rangeExpense = cachedExpenses.filter(e => e.date && e.date >= startStr && e.date <= endStr).reduce((s,e)=> s + Number(e.amount||0), 0);
  const {perMember, totalMeals} = tallyMeals(rangeMeals);
  const mealRate = totalMeals > 0 ? rangeExpense / totalMeals : 0;

  // Managers can download everyone's report together; members only ever see (and can only
  // ever download, since the download captures this same table) their own row.
  const membersToShow = isManager ? messMembers : messMembers.filter(m => m.userId === currentUser.uid);

  const tbody = table.querySelector('tbody');
  tbody.innerHTML = '';
  if(!membersToShow.length){
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">No data for this range yet.</div></td></tr>`;
    return;
  }
  membersToShow.forEach(m => {
    const mCounts = perMember[m.userId] || {lunch:0, dinner:0, total:0};
    const cost = mCounts.total * mealRate;
    const bal = Number(m.deposit||0) - cost;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(m.name)}</td>
      <td class="mono">${money(m.deposit)}</td>
      <td class="mono">${mCounts.lunch}</td>
      <td class="mono">${mCounts.dinner}</td>
      <td class="mono">${mCounts.total}</td>
      <td class="mono">${money(cost.toFixed(2))}</td>
      <td class="mono ${bal>=0?'pos':'neg'}">${bal>=0 ? money(bal.toFixed(2)) : '-' + money(Math.abs(bal).toFixed(2))}</td>
      <td><span class="pill ${bal>=0?'on':'off'}">${bal>=0 ? '✅ No Due' : '❌ Due: ' + money(Math.abs(bal).toFixed(2))}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function downloadReportAsJPG(){
  const el = document.getElementById('monthlyReportCapture');
  if(!el || !window.html2canvas){ toast('Report is still loading — try again in a moment.', 'err'); return; }
  toast('Preparing image…', 'ok');
  html2canvas(el, {backgroundColor:'#ffffff', scale:2}).then(canvas => {
    const link = document.createElement('a');
    link.download = 'mess-monthly-report.jpg';
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();
  }).catch(()=> toast('Could not generate the image.', 'err'));
}
function downloadReportAsPDF(){
  const el = document.getElementById('monthlyReportCapture');
  if(!el || !window.html2canvas || !window.jspdf){ toast('Report is still loading — try again in a moment.', 'err'); return; }
  toast('Preparing PDF…', 'ok');
  html2canvas(el, {backgroundColor:'#ffffff', scale:2}).then(canvas => {
    const { jsPDF } = window.jspdf;
    const imgData = canvas.toDataURL('image/png');
    const pxToMm = 0.264583;
    const wMm = canvas.width * pxToMm;
    const hMm = canvas.height * pxToMm;
    const pdf = new jsPDF({orientation: wMm > hMm ? 'landscape' : 'portrait', unit:'mm', format:[wMm, hMm]});
    pdf.addImage(imgData, 'PNG', 0, 0, wMm, hMm);
    pdf.save('mess-monthly-report.pdf');
  }).catch(()=> toast('Could not generate the PDF.', 'err'));
}
