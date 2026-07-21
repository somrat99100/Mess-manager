document.getElementById('year').textContent = new Date().getFullYear();

/* ============================================================
   FIREBASE CONFIG
   Replace with your own Firebase project config (Project Settings > General > Your apps).
============================================================ */
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
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
  const deadline = document.getElementById('newMessDeadline').value || '22:00';
  if(!name){ toast('Please enter a mess name', 'err'); return; }
  const inviteCode = genInviteCode(name);
  const messRef = db.collection('mess').doc();
  messRef.set({
    name, location, inviteCode, deadline,
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
    document.getElementById('setDeadline').value = currentMessDoc.deadline || '22:00';
    renderMealDeadlineNote();
  });
  unsubscribers.push(messSub);

  const membersSub = db.collection('messMembers').where('messId','==', currentMessId).onSnapshot(snap => {
    messMembers = snap.docs.map(d => ({id: d.id, ...d.data()}));
    renderMemberTable();
    renderDepositSelect();
    loadMealsForDate(document.getElementById('mealDatePicker').value || todayStr());
    renderDashboard();
  });
  unsubscribers.push(membersSub);

  const expSub = db.collection('expenses').where('messId','==', currentMessId).orderBy('createdAt','desc').onSnapshot(snap => {
    const expenses = snap.docs.map(d => ({id:d.id, ...d.data()}));
    renderExpenseTable(expenses);
    renderDashboard(expenses);
  });
  unsubscribers.push(expSub);

  const noticeSub = db.collection('notices').where('messId','==', currentMessId).orderBy('createdAt','desc').limit(20).onSnapshot(snap => {
    const notices = snap.docs.map(d => ({id:d.id, ...d.data()}));
    renderNoticeBoard(notices);
  });
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
function switchTab(tab){
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'tab-' + tab));
}

/* ============================================================
   MEALS
============================================================ */
let currentMealsCache = {}; // memberId -> {lunch,dinner,docId}

function isBeforeDeadlineFor(dateStr){
  // members may edit today's or future date's meals only while local time is before the mess deadline,
  // and only for dates that are today or later.
  if(!currentMessDoc) return false;
  const today = todayStr();
  if(dateStr < today) return false; // never edit past dates as a member
  if(dateStr > today) return true;  // future dates always editable pre-deadline
  const [h,m] = (currentMessDoc.deadline || '22:00').split(':').map(Number);
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
  const editable = isBeforeDeadlineFor(dateStr);
  note.classList.remove('hidden');
  note.textContent = editable
    ? `⏰ You can update this day's meals until ${currentMessDoc.deadline} today.`
    : `🔒 The meal deadline (${currentMessDoc.deadline}) has passed for this date — only your manager can change it now.`;
}

function loadMealsForDate(dateStr){
  if(!currentMessId || !dateStr) return;
  const mealId = currentMessId + '_' + dateStr;
  db.collection('meals').doc(mealId).get().then(doc => {
    const data = doc.exists ? doc.data() : {members: {}};
    currentMealsCache = data.members || {};
    renderMealTable(dateStr);
    renderMealDeadlineNote();
  });
}

function renderMealTable(dateStr){
  const tbody = document.querySelector('#mealTable tbody');
  tbody.innerHTML = '';
  const editable = myRole === 'manager' || isBeforeDeadlineFor(dateStr);
  const isManager = myRole === 'manager';
  messMembers.forEach(mem => {
    const rec = currentMealsCache[mem.userId] || {lunch:true, dinner:true, guest:0}; // default ON, 0 guests
    const guestCount = rec.guest || 0;
    const canEditThisRow = isManager ? true : (mem.userId === currentUser.uid && editable);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(mem.name)} ${mem.role==='manager' ? '<span class="pill role">Manager</span>' : ''}</td>
      <td><button class="meal-toggle ${rec.lunch ? 'on':''}" ${canEditThisRow?'':'disabled'} onclick="toggleMeal('${dateStr}','${mem.userId}','lunch')"><span class="knob"></span></button></td>
      <td><button class="meal-toggle ${rec.dinner ? 'on':''}" ${canEditThisRow?'':'disabled'} onclick="toggleMeal('${dateStr}','${mem.userId}','dinner')"><span class="knob"></span></button></td>
      <td>
        <div class="guest-stepper">
          <button ${isManager?'':'disabled'} onclick="setGuestMeals('${dateStr}','${mem.userId}',${guestCount - 1})">−</button>
          <span>${guestCount}</span>
          <button ${isManager?'':'disabled'} onclick="setGuestMeals('${dateStr}','${mem.userId}',${guestCount + 1})">+</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function toggleMeal(dateStr, memberId, type){
  const canEdit = myRole === 'manager' || (memberId === currentUser.uid && isBeforeDeadlineFor(dateStr));
  if(!canEdit){ toast('The meal deadline has passed — ask your manager to update this.', 'err'); return; }
  const mealId = currentMessId + '_' + dateStr;
  const current = currentMealsCache[memberId] || {lunch:true, dinner:true, guest:0};
  const newVal = !current[type];
  const ref = db.collection('meals').doc(mealId);
  ref.set({
    messId: currentMessId, date: dateStr,
    members: { [memberId]: { ...current, [type]: newVal } },
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: currentUser.uid
  }, {merge: true}).then(()=>{
    currentMealsCache[memberId] = { ...current, [type]: newVal };
    renderMealTable(dateStr);
    renderDashboard();
  }).catch(e => toast(e.message, 'err'));
}

// Guest meals: extra meals eaten by a member's guest on a given day.
// Manager-controlled since it directly affects shared cost distribution.
function setGuestMeals(dateStr, memberId, newCount){
  if(myRole !== 'manager'){ toast('Only the manager can add guest meals.', 'err'); return; }
  if(newCount < 0) newCount = 0;
  const mealId = currentMessId + '_' + dateStr;
  const current = currentMealsCache[memberId] || {lunch:true, dinner:true, guest:0};
  const ref = db.collection('meals').doc(mealId);
  ref.set({
    messId: currentMessId, date: dateStr,
    members: { [memberId]: { ...current, guest: newCount } },
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: currentUser.uid
  }, {merge: true}).then(()=>{
    currentMealsCache[memberId] = { ...current, guest: newCount };
    renderMealTable(dateStr);
    renderDashboard();
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
    tr.innerHTML = `
      <td>${esc(mem.name)}</td>
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
  sel.innerHTML = messMembers.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
}
function updateDeposit(){
  const docId = document.getElementById('depositMemberSelect').value;
  const amount = Number(document.getElementById('depositAmount').value);
  if(!docId || isNaN(amount)){ toast('Choose a member and enter an amount', 'err'); return; }
  db.collection('messMembers').doc(docId).update({deposit: amount})
    .then(()=> toast('Deposit updated', 'ok'))
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
    deadline: document.getElementById('setDeadline').value || '22:00'
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

function renderNoticeBoard(notices){
  const mainText = document.getElementById('noticeMainText');
  const mainMeta = document.getElementById('noticeMainMeta');
  const historyWrap = document.getElementById('noticeHistoryWrap');
  const historyList = document.getElementById('noticeHistoryList');

  if(!notices.length){
    mainText.textContent = 'No notices yet — be the first to post one.';
    mainMeta.textContent = '';
    historyWrap.classList.add('hidden');
    return;
  }
  const latest = notices[0];
  const latestDate = latest.createdAt ? latest.createdAt.toDate() : new Date();
  mainText.textContent = '“' + latest.text + '”';
  mainMeta.textContent = '— ' + latest.authorName + ' · ' + timeAgo(latestDate);

  const rest = notices.slice(1);
  if(rest.length){
    historyWrap.classList.remove('hidden');
    historyList.innerHTML = rest.map(n => {
      const d = n.createdAt ? n.createdAt.toDate() : null;
      return `<div class="notice-item"><span>${esc(n.text)} — <em>${esc(n.authorName)}</em></span><span class="n-meta">${timeAgo(d)}</span></div>`;
    }).join('');
  } else {
    historyWrap.classList.add('hidden');
  }
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
function renderDashboard(expensesArg){
  if(!currentMessId) return;
  const run = (expenses) => {
    const totalExpense = expenses.reduce((s,e)=> s + Number(e.amount||0), 0);
    // total meals: sum lunch+dinner ON counts across ALL days recorded for this mess
    db.collection('meals').where('messId','==', currentMessId).get().then(snap => {
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

      document.getElementById('mTotalCollection').textContent = money(totalDeposit);
      document.getElementById('mTotalExpense').textContent = money(totalExpense);
      document.getElementById('mTotalMeals').textContent = totalMeals;
      document.getElementById('mMealRate').textContent = money(mealRate.toFixed(2));
      document.getElementById('mFund').textContent = money(fund);
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
        if(m.userId === currentUser.uid) myBalance = bal;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${esc(m.name)}</td>
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
      document.getElementById('mMyBalance').textContent = money(myBalance.toFixed(2));
    });
  };
  if(expensesArg){ run(expensesArg); }
  else db.collection('expenses').where('messId','==', currentMessId).get().then(snap => run(snap.docs.map(d=>({id:d.id,...d.data()}))));
}
