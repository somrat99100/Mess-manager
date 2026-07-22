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
let unsubscribers = [];

/* ---------- utils ---------- */
function toast(msg, type){
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  document.getElementById('toastWrap').appendChild(el);
  setTimeout(()=> el.remove(), 3800);
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
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function genInviteCode(name){
  const base = (name||'MESS').toUpperCase().replace(/[^A-Z]/g,'').slice(0,4) || 'MESS';
  return base + '-' + Math.floor(1000 + Math.random()*9000);
}

/* ---------- view switching ---------- */
function showHomepage(){
  document.getElementById('homepage').classList.remove('hidden');
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appShell').style.display = 'none';
}
function showAuth(mode){
  document.getElementById('homepage').classList.add('hidden');
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('loginForm').classList.toggle('hidden', mode !== 'login');
  document.getElementById('registerForm').classList.toggle('hidden', mode !== 'register');
  document.getElementById('loginError').classList.add('hidden');
  document.getElementById('registerError').classList.add('hidden');
}
function showApp(){
  document.getElementById('homepage').classList.add('hidden');
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appShell').style.display = 'block';
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
      name, email, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }))
    .then(()=> toast('Account created — welcome!', 'ok'))
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
function doLogout(){
  unsubscribers.forEach(u => u());
  unsubscribers = [];
  auth.signOut();
}

auth.onAuthStateChanged(user => {
  if(user){
    currentUser = user;
    loadUserAndMess();
  } else {
    currentUser = null;
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
      document.getElementById('noMessState').classList.remove('hidden');
      document.getElementById('mainAppState').classList.add('hidden');
    } else {
      const md = snap.docs[0].data();
      currentMessId = md.messId;
      myRole = md.role;
      attachMessListeners();
      document.getElementById('noMessState').classList.add('hidden');
      document.getElementById('mainAppState').classList.remove('hidden');
    }
  }).catch(e => toast(e.message, 'err'));
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
    return db.collection('messMembers').doc(messDoc.id + '_' + currentUser.uid).set({
      messId: messDoc.id, userId: currentUser.uid,
      name: currentUserDoc.name, email: currentUserDoc.email,
      role: 'member', deposit: 0,
      joinedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(()=>{
      closeModal('joinMessModal');
      toast('Joined ' + messDoc.data().name + '!', 'ok');
      currentMessId = messDoc.id; myRole = 'member';
      document.getElementById('noMessState').classList.add('hidden');
      document.getElementById('mainAppState').classList.remove('hidden');
      attachMessListeners();
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
    renderMealDeadlineNote();
  }, e => toast('Could not load mess details: ' + e.message, 'err'));
  unsubscribers.push(messSub);

  const membersSub = db.collection('messMembers').where('messId','==', currentMessId).onSnapshot(snap => {
    messMembers = snap.docs.map(d => ({id: d.id, ...d.data()}));
    renderMemberTable();
    renderDepositSelect();
    loadMealsForDate(document.getElementById('mealDatePicker').value || todayStr());
    renderDashboard();
  }, e => toast('Could not load members: ' + e.message, 'err'));
  unsubscribers.push(membersSub);

  // No orderBy here on purpose — a where() + orderBy() combo needs a manually-created composite
  // Firestore index, and until that index exists the whole listener silently fails. Sorting in the
  // browser instead means expenses always show up right away, index or no index.
  const expSub = db.collection('expenses').where('messId','==', currentMessId).onSnapshot(snap => {
    const expenses = snap.docs.map(d => ({id:d.id, ...d.data({serverTimestamps: 'estimate'})}))
      .sort((a,b) => (b.createdAt ? b.createdAt.toMillis() : 0) - (a.createdAt ? a.createdAt.toMillis() : 0));
    renderExpenseTable(expenses);
    renderDashboard(expenses);
  }, e => toast('Could not load expenses: ' + e.message, 'err'));
  unsubscribers.push(expSub);

  const reqSub = db.collection('mealOffRequests').where('messId','==', currentMessId).onSnapshot(snap => {
    messMealOffRequests = snap.docs.map(d => ({id:d.id, ...d.data({serverTimestamps: 'estimate'})}));
    renderRequestsPanel();
    updateMealsTabBadge();
    const dateNow = document.getElementById('mealDatePicker').value || todayStr();
    renderMealCards(dateNow);
  }, e => toast('Could not load meal-off requests: ' + e.message, 'err'));
  unsubscribers.push(reqSub);

  const guestReqSub = db.collection('guestRequests').where('messId','==', currentMessId).onSnapshot(snap => {
    messGuestRequests = snap.docs.map(d => ({id:d.id, ...d.data({serverTimestamps: 'estimate'})}));
    renderRequestsPanel();
    updateMealsTabBadge();
    const dateNow = document.getElementById('mealDatePicker').value || todayStr();
    renderMealCards(dateNow);
  }, e => toast('Could not load guest requests: ' + e.message, 'err'));
  unsubscribers.push(guestReqSub);

  const noticeSub = db.collection('notices').where('messId','==', currentMessId).onSnapshot(snap => {
    const notices = snap.docs.map(d => ({id:d.id, ...d.data({serverTimestamps: 'estimate'})}))
      .sort((a,b) => (b.createdAt ? b.createdAt.toMillis() : 0) - (a.createdAt ? a.createdAt.toMillis() : 0))
      .slice(0, 20);
    renderNoticeBoard(notices);
  }, e => toast('Could not load notices: ' + e.message, 'err'));
  unsubscribers.push(noticeSub);

  if(!document.getElementById('mealDatePicker').value){
    document.getElementById('mealDatePicker').value = todayStr();
  }
  document.getElementById('mealDatePicker').addEventListener('change', e => loadMealsForDate(e.target.value));
  loadMealsForDate(document.getElementById('mealDatePicker').value);
}

/* ============================================================
   TAB SWITCHING
============================================================ */
function updateMealsTabBadge(){
  const badge = document.getElementById('mealsTabBadge');
  if(!badge) return;
  if(myRole !== 'manager'){ badge.classList.add('hidden'); return; }
  const count = messMealOffRequests.filter(r=>r.status==='pending').length + messGuestRequests.filter(r=>r.status==='pending').length;
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);
}
function switchTab(tab){
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'tab-' + tab));
}

/* ============================================================
   MEALS
============================================================ */
let currentMealsCache = {}; // memberId -> {lunch,dinner,guest}
let currentDayOff = false;  // whole-day "mess off" switch for the selected date

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
  }, e => toast('Could not load meals: ' + e.message, 'err'));
  unsubscribers.push(mealDocUnsub);
}

function formatDateLabel(dateStr){
  const d = new Date(dateStr + 'T00:00:00');
  if(isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
}

/* Daily total meal count — colorful summary box at the top of the Meals tab */
function renderDaySummary(dateStr){
  const dateLabelEl = document.getElementById('dayTotalDateLabel');
  if(!dateLabelEl) return; // not on this tab's DOM yet
  dateLabelEl.textContent = formatDateLabel(dateStr) + (dateStr === todayStr() ? ' · today' : '');
  let lunch = 0, dinner = 0, guest = 0, offCount = 0;
  messMembers.forEach(m => {
    const rec = currentMealsCache[m.userId] || {lunch:true, dinner:true, guest:0};
    if(rec.lunch) lunch++; else offCount++;
    if(rec.dinner) dinner++; else offCount++;
    guest += Number(rec.guest || 0);
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
      const cur = currentMealsCache[m.userId] || {lunch:true, dinner:true, guest:0};
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
    const rec = currentMealsCache[mem.userId] || {lunch:true, dinner:true, guest:0}; // default ON, 0 guests
    const guestCount = rec.guest || 0;
    const isSelf = mem.userId === currentUser.uid;

    // Manager: can edit any current-or-future day, never a past one. Member: only their own row,
    // only before that meal's deadline, and never once the day is fully switched off.
    const canEditLunch = isManager
      ? (!currentDayOff && !isPastDay)
      : (isSelf && !currentDayOff && isBeforeDeadlineFor(dateStr, 'lunch'));
    const canEditDinner = isManager
      ? (!currentDayOff && !isPastDay)
      : (isSelf && !currentDayOff && isBeforeDeadlineFor(dateStr, 'dinner'));

    const lunchPending = pendingOffForDate.find(r => r.memberId === mem.userId && r.mealType === 'lunch');
    const dinnerPending = pendingOffForDate.find(r => r.memberId === mem.userId && r.mealType === 'dinner');
    const guestPending = pendingGuestForDate.find(r => r.memberId === mem.userId);

    // Deadline passed but meal is still ON: the member can ask the manager to turn it off instead.
    const canRequestLunch = !isManager && isSelf && !currentDayOff && !isPastDay && rec.lunch && !canEditLunch && !lunchPending;
    const canRequestDinner = !isManager && isSelf && !currentDayOff && !isPastDay && rec.dinner && !canEditDinner && !dinnerPending;

    const lunchCell = lunchPending
      ? `<span class="request-pending-badge">Awaiting approval</span>`
      : canRequestLunch
        ? `<button class="btn-request-off" onclick="requestMealOff('${dateStr}','lunch')">Request off</button>`
        : `<button class="meal-toggle ${rec.lunch ? 'on':''}" ${canEditLunch?'':'disabled'} onclick="toggleMeal('${dateStr}','${mem.userId}','lunch')"><span class="knob"></span></button>`;

    const dinnerCell = dinnerPending
      ? `<span class="request-pending-badge">Awaiting approval</span>`
      : canRequestDinner
        ? `<button class="btn-request-off" onclick="requestMealOff('${dateStr}','dinner')">Request off</button>`
        : `<button class="meal-toggle ${rec.dinner ? 'on':''}" ${canEditDinner?'':'disabled'} onclick="toggleMeal('${dateStr}','${mem.userId}','dinner')"><span class="knob"></span></button>`;

    // Guest meals — manager taps a member's chip to set the exact count directly; a member taps
    // their own chip to request guest meals be added (goes to the manager for approval).
    let guestCell;
    if(guestPending){
      guestCell = `<span class="request-pending-badge">+${guestPending.count} pending</span>`;
    } else if(isManager && !currentDayOff && !isPastDay){
      guestCell = `<button class="guest-chip ${guestCount===0?'zero':''}" onclick="openGuestSetModal('${dateStr}','${mem.userId}','${esc(mem.name)}',${guestCount})">👤 ${guestCount}</button>`;
    } else if(!isManager && isSelf && !currentDayOff && !isPastDay){
      guestCell = `<button class="guest-chip ${guestCount===0?'zero':''}" onclick="openGuestRequestModal('${dateStr}')">👤 ${guestCount} <span class="g-plus">+ add</span></button>`;
    } else {
      guestCell = `<span class="guest-chip zero" style="cursor:default;">👤 ${guestCount}</span>`;
    }

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

/* ---------- meal-off requests: member asks after the deadline, manager approves/declines ---------- */
function requestMealOff(dateStr, mealType){
  if(myRole === 'manager') return;
  if(dateStr < todayStr()){ toast('Past days can\u2019t be changed.', 'err'); return; }
  const already = messMealOffRequests.find(r => r.date === dateStr && r.mealType === mealType && r.memberId === currentUser.uid && r.status === 'pending');
  if(already){ toast('You already have a pending request for this meal.', 'err'); return; }
  db.collection('mealOffRequests').add({
    messId: currentMessId, date: dateStr, mealType,
    memberId: currentUser.uid, memberName: currentUserDoc.name,
    status: 'pending',
    requestedAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(()=> toast('Off-request sent to your manager', 'ok'))
    .catch(e => toast(e.message, 'err'));
}

function approveMealOffRequest(reqId){
  if(myRole !== 'manager') return;
  const req = messMealOffRequests.find(r => r.id === reqId);
  if(!req) return;
  const mealId = currentMessId + '_' + req.date;
  db.collection('meals').doc(mealId).set({
    messId: currentMessId, date: req.date,
    members: { [req.memberId]: { [req.mealType]: false } },
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: currentUser.uid
  }, {merge: true}).then(()=> db.collection('mealOffRequests').doc(reqId).update({
    status: 'approved', respondedAt: firebase.firestore.FieldValue.serverTimestamp(), respondedBy: currentUser.uid
  })).then(()=>{
    toast(`${req.memberName}'s ${req.mealType} marked off`, 'ok');
    renderDashboard();
  }).catch(e => toast(e.message, 'err'));
}

function rejectMealOffRequest(reqId){
  if(myRole !== 'manager') return;
  db.collection('mealOffRequests').doc(reqId).update({
    status: 'rejected',
    respondedAt: firebase.firestore.FieldValue.serverTimestamp(),
    respondedBy: currentUser.uid
  }).then(()=> toast('Request declined', 'ok')).catch(e => toast(e.message, 'err'));
}

/* ---------- guest-meal requests: member asks for guest meals to be added, manager approves/declines ---------- */
let guestRequestDate = null; // set when the "request guest meals" modal opens
function openGuestRequestModal(dateStr){
  guestRequestDate = dateStr;
  document.getElementById('guestRequestModalSub').textContent = `For ${formatDateLabel(dateStr)}. Your manager will review and approve this.`;
  document.getElementById('guestRequestCount').value = 1;
  openModal('guestRequestModal');
}
function submitGuestRequest(){
  const count = Number(document.getElementById('guestRequestCount').value);
  if(!guestRequestDate || !count || count <= 0){ toast('Enter how many guest meals you need', 'err'); return; }
  const already = messGuestRequests.find(r => r.date === guestRequestDate && r.memberId === currentUser.uid && r.status === 'pending');
  if(already){ toast('You already have a pending guest-meal request for this day.', 'err'); closeModal('guestRequestModal'); return; }
  db.collection('guestRequests').add({
    messId: currentMessId, date: guestRequestDate, count,
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
  db.collection('meals').doc(mealId).set({
    messId: currentMessId, date: req.date,
    members: { [req.memberId]: { guest: firebase.firestore.FieldValue.increment(req.count) } },
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: currentUser.uid
  }, {merge: true}).then(()=> db.collection('guestRequests').doc(reqId).update({
    status: 'approved', respondedAt: firebase.firestore.FieldValue.serverTimestamp(), respondedBy: currentUser.uid
  })).then(()=>{
    toast(`Added ${req.count} guest meal(s) for ${req.memberName}`, 'ok');
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
let guestSetContext = null; // {dateStr, memberId}
function openGuestSetModal(dateStr, memberId, memberName, currentCount){
  guestSetContext = {dateStr, memberId};
  document.getElementById('guestSetModalTitle').textContent = `Guest meals — ${memberName}`;
  document.getElementById('guestSetModalSub').textContent = `For ${formatDateLabel(dateStr)}.`;
  document.getElementById('guestSetCount').value = currentCount;
  openModal('guestSetModal');
}
function submitGuestSet(){
  if(!guestSetContext) return;
  const count = Number(document.getElementById('guestSetCount').value);
  if(isNaN(count) || count < 0){ toast('Enter a valid guest count', 'err'); return; }
  setGuestMeals(guestSetContext.dateStr, guestSetContext.memberId, count);
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
      return `
      <div class="request-row">
        <div class="request-info">
          <span class="request-tag off">Off</span><strong>${esc(r.memberName)}</strong> wants ${esc(r.mealType)} off on ${esc(formatDateLabel(r.date))}
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
          <span class="request-tag guest">Guest</span><strong>${esc(r.memberName)}</strong> wants +${r.count} guest meal(s) on ${esc(formatDateLabel(r.date))}
          <span class="r-meta">Requested ${when}</span>
        </div>
        <div class="request-actions">
          <button class="btn tiny approve" onclick="approveGuestRequest('${r.id}')">Approve</button>
          <button class="btn tiny reject" onclick="rejectGuestRequest('${r.id}')">Decline</button>
        </div>
      </div>`;
  }).join('');
}

function toggleMeal(dateStr, memberId, type){
  if(currentDayOff && myRole !== 'manager'){ toast('Meals are switched off for this day.', 'err'); return; }
  const isPastDay = dateStr < todayStr();
  if(myRole === 'manager' && isPastDay){ toast('Past days can\u2019t be edited.', 'err'); return; }
  const canEdit = myRole === 'manager'
    ? !isPastDay
    : (memberId === currentUser.uid && isBeforeDeadlineFor(dateStr, type));
  if(!canEdit){
    const label = type === 'dinner' ? 'dinner' : 'lunch';
    toast(`The ${label} deadline has passed — send an off-request instead.`, 'err');
    return;
  }
  const mealId = currentMessId + '_' + dateStr;
  const current = currentMealsCache[memberId] || {lunch:true, dinner:true, guest:0};
  const newVal = !current[type];
  db.collection('meals').doc(mealId).set({
    messId: currentMessId, date: dateStr,
    members: { [memberId]: { [type]: newVal } },
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: currentUser.uid
  }, {merge: true}).then(()=> renderDashboard()).catch(e => toast(e.message, 'err'));
}

// Guest meals: extra meals eaten by a member's guest on a given day.
// Manager sets the exact count directly (via the guest-set modal); members request additions instead.
function setGuestMeals(dateStr, memberId, newCount){
  if(myRole !== 'manager'){ toast('Only the manager can set guest meals directly — send a request instead.', 'err'); return; }
  if(dateStr < todayStr()){ toast('Past days can\u2019t be edited.', 'err'); return; }
  if(newCount < 0) newCount = 0;
  const mealId = currentMessId + '_' + dateStr;
  db.collection('meals').doc(mealId).set({
    messId: currentMessId, date: dateStr,
    members: { [memberId]: { guest: newCount } },
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
      <td class="mono">${esc(e.date)}</td>
      <td>${esc(e.category)}</td>
      <td>${esc(e.description||'—')}</td>
      <td class="mono">${money(e.amount)}</td>
      <td class="manager-only hidden"><button class="btn danger small" onclick="deleteExpense('${e.id}')">Delete</button></td>
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
    tr.innerHTML = `
      <td>${esc(mem.name)} ${isSelf ? '<span class="pill you">You</span>' : ''}</td>
      <td><span class="pill role">${mem.role}</span></td>
      <td class="mono">${money(mem.deposit)}</td>
      <td class="manager-only hidden">
        ${isSelf ? '' : `<button class="btn outline small" onclick="promoteMember('${mem.id}','${esc(mem.name)}','${mem.role}')">${mem.role==='manager' ? 'Make member' : 'Make manager'}</button>`}
      </td>
    `;
    tbody.appendChild(tr);
  });
  applyRoleUI();
}
function promoteMember(docId, name, currentRole){
  const newRole = currentRole === 'manager' ? 'member' : 'manager';
  document.getElementById('promoteModalTitle').textContent = newRole === 'manager' ? 'Make manager' : 'Remove manager role';
  document.getElementById('promoteModalBody').textContent = newRole === 'manager'
    ? `${name} will gain full manager access — they can edit meals, expenses, and settings for everyone.`
    : `${name} will become a regular member and lose manager access.`;
  document.getElementById('promoteConfirmBtn').onclick = () => {
    db.collection('messMembers').doc(docId).update({role: newRole})
      .then(()=>{ closeModal('promoteModal'); toast('Role updated', 'ok'); })
      .catch(e => toast(e.message, 'err'));
  };
  openModal('promoteModal');
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
// Corrects a member's deposit to an exact figure (e.g. fixing a typo), overwriting rather than adding.
function setExactDeposit(){
  const docId = document.getElementById('depositMemberSelect').value;
  const amount = Number(document.getElementById('depositAmount').value);
  if(!docId || isNaN(amount) || amount < 0){ toast('Choose a member and enter a valid amount', 'err'); return; }
  db.collection('messMembers').doc(docId).update({deposit: amount})
    .then(()=>{
      document.getElementById('depositAmount').value = '';
      toast('Deposit corrected', 'ok');
    })
    .catch(e => toast(e.message, 'err'));
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
    dinnerDeadline: document.getElementById('setDinnerDeadline').value || '16:00'
  }).then(()=> toast('Mess settings saved', 'ok')).catch(e => toast(e.message,'err'));
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
  }).catch(e => toast(e.message, 'err'));
}

/* ============================================================
   DASHBOARD CALCULATIONS
============================================================ */
let dashboardRenderToken = 0; // guards against a slow/stale async response overwriting a newer render
function renderDashboard(expensesArg){
  if(!currentMessId) return;
  const myToken = ++dashboardRenderToken;
  const run = (expenses) => {
    const totalExpense = expenses.reduce((s,e)=> s + Number(e.amount||0), 0);
    // total meals: sum lunch+dinner ON counts across ALL days recorded for this mess
    db.collection('meals').where('messId','==', currentMessId).get().then(snap => {
      if(myToken !== dashboardRenderToken) return; // a newer render has already started — drop this stale one
      let totalMeals = 0;
      const perMember = {}; // userId -> {lunch, dinner, guest, total}
      messMembers.forEach(m => perMember[m.userId] = {lunch:0, dinner:0, guest:0, total:0});
      snap.forEach(doc => {
        const members = doc.data().members || {};
        Object.keys(members).forEach(uid => {
          if(!perMember[uid]) perMember[uid] = {lunch:0, dinner:0, guest:0, total:0};
          const rec = members[uid];
          const guest = Number(rec.guest||0);
          let c = 0;
          if(rec.lunch){ c++; perMember[uid].lunch++; }
          if(rec.dinner){ c++; perMember[uid].dinner++; }
          c += guest;
          perMember[uid].guest += guest;
          totalMeals += c;
          perMember[uid].total += c;
        });
      });
      const totalDeposit = messMembers.reduce((s,m)=> s + Number(m.deposit||0), 0);
      const mealRate = totalMeals > 0 ? totalExpense / totalMeals : 0;
      const fund = totalDeposit - totalExpense;

      setMetric('mTotalCollection', money(totalDeposit));
      setMetric('mTotalExpense', money(totalExpense));
      setMetric('mTotalMeals', totalMeals);
      setMetric('mMealRate', money(mealRate.toFixed(2)));
      setMetric('mFund', money(fund));
      const statusEl = document.getElementById('mStatus');
      statusEl.textContent = fund >= 0 ? '✅ Positive' : '⚠️ Negative';
      statusEl.style.color = fund >= 0 ? 'var(--good)' : 'var(--bad)';

      const tbody = document.querySelector('#dashboardMemberTable tbody');
      tbody.innerHTML = '';
      let myBalance = 0;
      messMembers.forEach(m => {
        const mCounts = perMember[m.userId] || {lunch:0, dinner:0, guest:0, total:0};
        const meals = mCounts.total;
        const cost = meals * mealRate;
        const bal = Number(m.deposit||0) - cost;
        const isSelf = m.userId === currentUser.uid;
        if(isSelf) myBalance = bal;
        const tr = document.createElement('tr');
        if(isSelf) tr.style.background = 'var(--cream)';
        tr.innerHTML = `
          <td>${esc(m.name)} ${isSelf ? '<span class="pill you">You</span>' : ''}</td>
          <td class="mono">${money(m.deposit)}</td>
          <td class="mono">${mCounts.lunch}</td>
          <td class="mono">${mCounts.dinner}</td>
          <td class="mono">${mCounts.guest}</td>
          <td class="mono">${meals}</td>
          <td class="mono">${money(cost.toFixed(2))}</td>
          <td class="mono">${money(bal.toFixed(2))}</td>
          <td><span class="pill ${bal>=0?'on':'off'}">${bal>=0 ? 'No due' : 'Due'}</span></td>
        `;
        tbody.appendChild(tr);
      });
      setMetric('mMyBalance', money(myBalance.toFixed(2)));
    });
  };
  if(expensesArg){ run(expensesArg); }
  else db.collection('expenses').where('messId','==', currentMessId).get().then(snap => run(snap.docs.map(d=>({id:d.id,...d.data()}))));
}
