// app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, where, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyDrVXpZfLwm0iddsaQWyXzRCvZ0bXkwviA",
    authDomain: "encuesta-santillana.firebaseapp.com",
    projectId: "encuesta-santillana",
    storageBucket: "encuesta-santillana.firebasestorage.app",
    messagingSenderId: "354271667135",
    appId: "1:354271667135:web:9edb98cb6c5f868a7e370a"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const BusinessRules = { metasCiclo: { 'AAA': 6, 'RI': 4, 'AA': 3 } };

const State = {
    colegiosBD: [], 
    coachesAuth: [], 
    encuestasData: [], 
    filteredEncuestas: [], 
    registrosFiltrados: [],
    encuestasLoaded: false, 
    currentUserRole: null, 
    loginUser: null, 
    currentView: 'formTab', 
    currentEdicionView: 'colegios',
    paginationLimit: 50, 
    currentRendered: 0,
    selectedRegistros: new Set(),
    regSort: { col: 'timestamp', dir: 'desc' } // Control para Ordenamiento A-Z
};

// Escapa caracteres especiales de HTML para evitar inyección al renderizar
// campos de texto libre (sugerencias, nombres, etc.) con innerHTML.
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const mesesNombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Lee un campo qN respetando valores 0 (un 0 explícito no debe tratarse como "ausente").
// Revisa primero la clave en minúsculas y, solo si esa propiedad no existe, intenta la versión en mayúsculas.
function getQVal(d, q) {
    const lower = d[q];
    if (lower !== undefined && lower !== null && lower !== '') return parseFloat(lower);
    const upper = d[q?.toUpperCase()];
    if (upper !== undefined && upper !== null && upper !== '') return parseFloat(upper);
    return NaN;
}

// Formatea un valor de fecha (timestamp, string DD/MM/YYYY, ISO o serial Excel) a "DD/MM/YYYY" para mostrar.
function formatFechaDisplay(d) {
    if (d.timestamp) return new Date(d.timestamp).toLocaleDateString('es-CO');
    if (d.fecha) {
        const dateObj = parseFechaToDate(d.fecha);
        if (dateObj) return `${dateObj.getDate().toString().padStart(2,'0')}/${(dateObj.getMonth()+1).toString().padStart(2,'0')}/${dateObj.getFullYear()}`;
        return String(d.fecha).split(',')[0].trim();
    }
    return 'Sin fecha';
}
// Devuelve null si no se puede interpretar de forma fiable, en vez de devolver una fecha incorrecta (ej. 1970).
function parseFechaToDate(fechaVal) {
    if (fechaVal === null || fechaVal === undefined || fechaVal === '') return null;

    // Número serial de Excel (días desde 1899-12-30)
    if (typeof fechaVal === 'number' || /^\d+(\.\d+)?$/.test(String(fechaVal).trim())) {
        const serial = Number(fechaVal);
        if (serial > 0) {
            const epoch = new Date(Date.UTC(1899, 11, 30));
            const d = new Date(epoch.getTime() + serial * 86400000);
            if (!isNaN(d.getTime())) return d;
        }
        return null;
    }

    const fechaStr = String(fechaVal).split(',')[0].trim();

    // Formato DD/MM/YYYY o D/M/YYYY
    const parts = fechaStr.split('/');
    if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const year = parseInt(parts[2], 10);
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
            const d = new Date(year, month - 1, day);
            if (!isNaN(d.getTime())) return d;
        }
        return null;
    }

    // Formato ISO (YYYY-MM-DD, etc.)
    if (/^\d{4}-\d{2}-\d{2}/.test(fechaStr)) {
        const d = new Date(fechaStr);
        if (!isNaN(d.getTime())) return d;
        return null;
    }

    // Formato no reconocido: no asumir milisegundos desde 1970 (evita fechas falsas tipo 1970).
    return null;
}

async function initApp() {
    try {
        const cachedCol = localStorage.getItem('santillana_colegios');
        const cachedCoach = localStorage.getItem('santillana_coaches');
        const cachedVersion = localStorage.getItem('santillana_cache_version');

        let remoteVersion = null;
        try {
            const metaSnap = await getDocs(collection(db, "meta"));
            metaSnap.forEach(d => { if (d.id === 'cacheVersion') remoteVersion = String(d.data().updatedAt || ''); });
        } catch (e) {
            // Si falla la consulta de versión (ej. sin conexión), usamos lo que haya en caché si existe.
            console.warn("No se pudo verificar versión remota de caché:", e);
        }

        const isCacheValid = cachedCol && cachedCoach && cachedVersion && (remoteVersion === null || remoteVersion === cachedVersion);

        if (isCacheValid) {
            State.colegiosBD = JSON.parse(cachedCol) || [];
            State.coachesAuth = JSON.parse(cachedCoach) || [];
            App.poblarCoaches();
            return; 
        }

        const colSnap = await getDocs(collection(db, "colegios"));
        State.colegiosBD = [];
        colSnap.forEach(d => State.colegiosBD.push({ id: d.id, ...d.data() }));

        const coachSnap = await getDocs(collection(db, "coaches"));
        State.coachesAuth = [];
        coachSnap.forEach(d => State.coachesAuth.push({ id: d.id, ...d.data() }));

        localStorage.setItem('santillana_colegios', JSON.stringify(State.colegiosBD));
        localStorage.setItem('santillana_coaches', JSON.stringify(State.coachesAuth));
        if (remoteVersion !== null) localStorage.setItem('santillana_cache_version', remoteVersion);
        else localStorage.removeItem('santillana_cache_version');
        
        App.poblarCoaches();

    } catch (error) {
        console.error("Error inicializando bases de datos:", error);
    }
}

// Marca la caché de colegios/coaches como obsoleta para TODOS los clientes,
// escribiendo una nueva versión en Firestore (meta/cacheVersion).
async function invalidateRemoteCache() {
    try {
        const newVersion = Date.now().toString();
        await setDoc(doc(db, "meta", "cacheVersion"), { updatedAt: newVersion });
        localStorage.setItem('santillana_cache_version', newVersion);
    } catch (e) {
        console.error("No se pudo invalidar la caché remota:", e);
        // Como respaldo, al menos invalidamos la caché local de este navegador.
        localStorage.removeItem('santillana_cache_version');
    }
}

async function fetchEncuestas() {
    if (State.encuestasLoaded) return;
    try {
        let q;
        if (State.currentUserRole === 'admin') {
            q = query(collection(db, "encuestas"));
        } else {
            const userName = State.loginUser ? State.loginUser.nombre : "";
            q = query(collection(db, "encuestas"), where("coach", "==", userName));
        }
            
        const encuestasSnap = await getDocs(q);
        State.encuestasData = [];
        encuestasSnap.forEach((d) => State.encuestasData.push({ id: d.id, ...d.data() }));
        State.encuestasData.sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
        
        State.encuestasLoaded = true;
    } catch (error) { 
        console.error("Error cargando encuestas:", error); 
    }
}

window.App = {
    switchTab: function(tabId) {
        ['formTab', 'dashTab'].forEach(id => { const el = document.getElementById(id); if(el) el.classList.add('hidden'); });
        const targetTab = document.getElementById(tabId); if(targetTab) targetTab.classList.remove('hidden');
        
        ['btn-formTab', 'btn-dashTab', 'btn-coachTab'].forEach(btn => { const el = document.getElementById(btn); if(el) el.classList.remove('tab-active'); });
        if(tabId === 'formTab') { const b = document.getElementById('btn-formTab'); if(b) b.classList.add('tab-active'); }
        else if(State.currentUserRole === 'admin') { const b = document.getElementById('btn-dashTab'); if(b) b.classList.add('tab-active'); }
        else { const b = document.getElementById('btn-coachTab'); if(b) b.classList.add('tab-active'); }
        
        if(tabId === 'dashTab') App.updateDashboard();
    },

    attemptLogin: function(role) {
        if (State.currentUserRole === role) { this.switchTab('dashTab'); return; }
        const title = role === 'admin' ? "Coordinación Santillana" : "Acceso Coach Académico";
        this.showModal(title, `
            <div class="space-y-4">
                <input type="email" id="loginEmail" class="w-full border rounded-xl px-4 py-3" placeholder="Correo corporativo">
                <input type="password" id="loginPwd" class="w-full border rounded-xl px-4 py-3" placeholder="Contraseña">
                <p id="loginError" class="text-red-500 text-xs hidden font-bold"></p>
            </div>
        `, `<button type="button" onclick="App.hideModal()" class="px-6 py-2 bg-gray-100 rounded-xl font-bold">Cancelar</button>
            <button type="button" onclick="App.verifyLogin('${role}')" class="px-6 py-2 bg-orange-600 text-white rounded-xl font-bold">Entrar</button>`);
    },

    verifyLogin: async function(role) {
        const emailInput = document.getElementById('loginEmail').value.trim().toLowerCase();
        const passInput = document.getElementById('loginPwd').value;
        const errEl = document.getElementById('loginError');

        try {
            let userFound = null;
            if (role === 'admin') {
                try {
                    const cred = await signInWithEmailAndPassword(auth, emailInput, passInput);
                    userFound = { email: cred.user.email, nombre: 'JBECERRA' };
                } catch (authErr) {
                    console.error("Firebase Auth error:", authErr.code, authErr.message);
                    throw new Error("Credenciales de administrador incorrectas. (" + authErr.code + ")");
                }
            } else {
                const safeCoaches = Array.isArray(State.coachesAuth) ? State.coachesAuth : [];
                const coachInfo = safeCoaches.find(c => c.email && c.email.toLowerCase() === emailInput);
                if (!coachInfo) throw new Error("Correo no registrado como coach.");
                const validPass = coachInfo.pass || '12345'; 
                if (validPass !== passInput) throw new Error("Contraseña incorrecta.");
                userFound = coachInfo;
            }

            State.currentUserRole = role; 
            State.loginUser = userFound; 
            State.encuestasLoaded = false; 
            this.hideModal();
            
            const userControls = document.getElementById('user-controls');
            if(userControls) { userControls.classList.remove('hidden'); userControls.classList.add('flex'); }
            const navName = document.getElementById('nav-user-name'); if(navName) navName.innerText = State.loginUser.nombre;
            const navRole = document.getElementById('nav-user-role'); if(navRole) navRole.innerText = role;
            
            this.configureDashboardUI(role);
            await fetchEncuestas();
            this.initFiltrosBasicos();
            this.switchTab('dashTab');
        } catch (error) { 
            if(errEl) { errEl.innerText = error.message; errEl.classList.remove('hidden'); }
        }
    },

    configureDashboardUI: function(role) {
        const isAdmin = role === 'admin';
        document.getElementById('adminSubNav')?.classList.toggle('hidden', !isAdmin);
        document.getElementById('coachWelcomeBar')?.classList.toggle('hidden', isAdmin);
        document.getElementById('container_filter_coach')?.classList.toggle('hidden', !isAdmin);
        document.getElementById('block_rank_coach')?.classList.toggle('hidden', !isAdmin);
        
        const dynGrid = document.getElementById('rankings_grid');
        if(dynGrid) dynGrid.className = isAdmin ? 'grid grid-cols-1 lg:grid-cols-2 gap-6' : 'grid grid-cols-1 gap-6';
        
        document.getElementById('coach_registros_box')?.classList.toggle('hidden', isAdmin);
        document.getElementById('container_reg_filter_regional')?.classList.toggle('hidden', !isAdmin);
        document.getElementById('container_reg_filter_coach')?.classList.toggle('hidden', !isAdmin);
        
        const coreTable = document.getElementById('registros_core_container');
        if(coreTable) {
            if(isAdmin) document.getElementById('subTabRegistros')?.appendChild(coreTable);
            else document.getElementById('content_coach_registros')?.appendChild(coreTable);
        }
    },

    logout: function() {
        if (State.currentUserRole === 'admin') {
            signOut(auth).catch(err => console.error("Error al cerrar sesión de Firebase Auth:", err));
        }
        State.currentUserRole = null; State.loginUser = null; State.encuestasLoaded = false;
        State.encuestasData = []; State.filteredEncuestas = []; State.selectedRegistros.clear();
        this.updateBulkActionBar();
        const uc = document.getElementById('user-controls');
        if(uc) { uc.classList.add('hidden'); uc.classList.remove('flex'); }
        this.switchTab('formTab');
    },

    saveNewPassword: async function() {
        const p1 = document.getElementById('new_pass').value;
        const p2 = document.getElementById('new_pass_confirm').value;
        const errEl = document.getElementById('pass_error');
        if(!p1 || p1 !== p2) { if(errEl) errEl.classList.remove('hidden'); return; }
        
        try {
            if (State.currentUserRole === 'coach') {
                const safeCoaches = Array.isArray(State.coachesAuth) ? State.coachesAuth : [];
                const idx = safeCoaches.findIndex(c => c.email === State.loginUser.email);
                if(idx !== -1) { 
                    State.coachesAuth[idx].pass = p1; 
                    await setDoc(doc(db, "coaches", State.coachesAuth[idx].id), State.coachesAuth[idx]);
                    localStorage.setItem('santillana_coaches', JSON.stringify(State.coachesAuth));
                }
            } else { alert("La contraseña de Administrador no se puede cambiar desde este panel."); }
            App.showModal("Éxito", "<p>Tu contraseña ha sido actualizada en el sistema.</p>", `<button type="button" onclick="App.hideModal()" class="px-6 py-2 bg-[#002C5F] text-white rounded-xl font-bold">Aceptar</button>`);
        } catch (e) { alert("Error actualizando la contraseña en la base de datos."); }
    },

    toggleCoachRegistros: function() {
        const content = document.getElementById('content_coach_registros');
        const icon = document.getElementById('icon_coach_registros');
        if(content && icon) {
            if(content.classList.contains('hidden')) { content.classList.remove('hidden'); icon.classList.add('rotate-180'); } 
            else { content.classList.add('hidden'); icon.classList.remove('rotate-180'); }
        }
    },

    openChangePasswordModal: function() {
        App.showModal("Cambiar Contraseña", `<div class="space-y-4"><input type="password" id="new_pass" class="w-full border rounded-xl px-4 py-3" placeholder="Nueva contraseña"><input type="password" id="new_pass_confirm" class="w-full border rounded-xl px-4 py-3" placeholder="Confirmar nueva contraseña"></div><p id="pass_error" class="text-red-500 text-sm mt-2 hidden font-bold">Las contraseñas no coinciden o están vacías.</p>`, `<button type="button" onclick="App.hideModal()" class="px-6 py-2 bg-gray-200 rounded-xl font-bold">Cancelar</button><button type="button" onclick="App.saveNewPassword()" class="px-6 py-2 bg-[#FF5A00] text-white rounded-xl font-bold">Guardar</button>`);
    },

    toggleDropdown: function(id, btnId) { 
        const el = document.getElementById(id); const btn = document.getElementById(btnId);
        if (el) {
            const isHidden = el.classList.contains('hidden');
            if (isHidden) { el.classList.remove('hidden'); el.setAttribute('aria-hidden', 'false'); if(btn) btn.setAttribute('aria-expanded', 'true'); } 
            else { el.classList.add('hidden'); el.setAttribute('aria-hidden', 'true'); if(btn) btn.setAttribute('aria-expanded', 'false'); }
        } 
    },

    initFiltrosBasicos: function() {
        const safeColegios = Array.isArray(State.colegiosBD) ? State.colegiosBD : [];
        const lineas = [...new Set(safeColegios.map(c => c.lineaNegocio ? c.lineaNegocio.trim() : '').filter(Boolean))].sort();
        const dropLineas = document.getElementById('dropdown_lineas');
        if (dropLineas) {
            dropLineas.innerHTML = '';
            lineas.forEach(l => { dropLineas.innerHTML += `<label class="linea-label-container flex items-center space-x-2 p-2 hover:bg-orange-50 rounded-lg cursor-pointer transition-colors"><input type="checkbox" value="${l}" class="linea-cb accent-[#FF5A00] w-4 h-4" onchange="App.handleFilterTrigger()"><span class="text-xs font-medium text-gray-700">${l}</span></label>`; });
        }
        
        const dropMeses = document.getElementById('dropdown_meses');
        if (dropMeses) {
            dropMeses.innerHTML = '';
            mesesNombres.forEach((m, idx) => { dropMeses.innerHTML += `<label class="flex items-center space-x-2 p-2 hover:bg-blue-50 rounded-lg cursor-pointer transition-colors border border-transparent hover:border-blue-100"><input type="checkbox" value="${idx}" class="mes-cb accent-[#002C5F] w-4 h-4" onchange="App.handleFilterTrigger()"><span class="text-xs font-medium text-gray-700">${m}</span></label>`; });
        }
        this.handleFilterTrigger(); 
    },

    handleFilterTrigger: function() { this.refreshCascadingFilters(); this.updateDashboard(); },

    refreshCascadingFilters: function() {
        const safeColegios = Array.isArray(State.colegiosBD) ? State.colegiosBD : [];
        let base = safeColegios.filter(c => c.colegio !== "[NUEVO COACH SIN COLEGIO]");
        
        const regEl = document.getElementById('filter_regional'); const coachEl = document.getElementById('filter_coach');
        const colEl = document.getElementById('filter_colegio'); const calEl = document.getElementById('filter_calendario');
        const clasEl = document.getElementById('filter_clasificacion'); const lineasCbs = document.querySelectorAll('.linea-cb:checked');
        
        const regVal = regEl?.value || ""; const coachVal = State.currentUserRole === 'admin' ? (coachEl?.value || "") : (State.loginUser?.nombre || "");
        const colVal = colEl?.value || ""; const calVal = calEl?.value || ""; const clasVal = clasEl?.value || "";
        const lineasVal = lineasCbs ? Array.from(lineasCbs).map(cb => cb.value) : [];

        const getFilteredExcluding = (exclude) => {
            return base.filter(c => {
                if (exclude !== 'regional' && regVal && c.regional !== regVal) return false;
                if (exclude !== 'coach' && coachVal && c.coach !== coachVal) return false;
                if (exclude !== 'colegio' && colVal && c.colegio !== colVal) return false;
                if (exclude !== 'calendario' && calVal && (c.calendario ? c.calendario.trim().toUpperCase() : '') !== calVal) return false;
                if (exclude !== 'clasificacion' && clasVal && c.clasificacion !== clasVal) return false;
                if (exclude !== 'lineas' && lineasVal.length > 0 && c.lineaNegocio && !lineasVal.includes(c.lineaNegocio.trim())) return false;
                return true;
            });
        };

        const updateSelect = (el, validData, text, currentVal) => {
            if(!el) return; el.innerHTML = `<option value="">${text}</option>`; validData.forEach(v => el.innerHTML += `<option value="${v}">${v}</option>`); if (validData.includes(currentVal)) el.value = currentVal;
        };

        updateSelect(regEl, [...new Set(getFilteredExcluding('regional').map(c => c.regional).filter(Boolean))].sort(), "Todas", regVal);
        if (State.currentUserRole === 'admin') updateSelect(coachEl, [...new Set(getFilteredExcluding('coach').map(c => c.coach))].sort(), "Todos los Coaches", coachVal);
        updateSelect(colEl, [...new Set(getFilteredExcluding('colegio').map(c => c.colegio))].sort(), "Todos los Colegios", colVal);
        updateSelect(calEl, [...new Set(getFilteredExcluding('calendario').map(c => c.calendario ? c.calendario.trim().toUpperCase() : '').filter(Boolean))].sort(), "Todos", calVal);
        updateSelect(clasEl, [...new Set(getFilteredExcluding('clasificacion').map(c => c.clasificacion ? c.clasificacion.trim() : '').filter(Boolean))].sort(), "Todas", clasVal);

        const validLineas = new Set(getFilteredExcluding('lineas').map(c => c.lineaNegocio ? c.lineaNegocio.trim() : '').filter(Boolean));
        let numChecked = 0;
        document.querySelectorAll('.linea-label-container').forEach(label => {
            const cb = label.querySelector('input');
            if (validLineas.has(cb.value)) { label.style.display = 'flex'; if(cb.checked) numChecked++; } 
            else { label.style.display = 'none'; cb.checked = false; }
        });
        
        const textSpan = document.getElementById('text_filter_lineas');
        if(textSpan) {
            if (numChecked === 0) textSpan.textContent = "Todas"; else if (numChecked === 1) textSpan.textContent = document.querySelector('.linea-cb:checked').value; else textSpan.textContent = `${numChecked} seleccionadas`;
        }

        const tSel = document.getElementById('filter_taller');
        if (tSel && colEl) {
            if (colEl.value !== "") { tSel.disabled = false; tSel.classList.remove('cursor-not-allowed'); document.getElementById('container_filter_taller')?.classList.remove('opacity-50'); tSel.options[0].text = "Todos los Talleres"; } 
            else { tSel.value = ""; tSel.disabled = true; tSel.classList.add('cursor-not-allowed'); document.getElementById('container_filter_taller')?.classList.add('opacity-50'); tSel.options[0].text = "Primero elija colegio"; }
        }
    },

    updateDashboard: function() {
        const errBanner = document.getElementById('dash_error_banner');
        if (errBanner) errBanner.classList.add('hidden');
        try {
            const safeEncuestas = Array.isArray(State.encuestasData) ? State.encuestasData : [];
            const safeColegios = Array.isArray(State.colegiosBD) ? State.colegiosBD : [];

            const regF = document.getElementById('filter_regional')?.value || ""; 
            const coachF = State.currentUserRole === 'admin' ? (document.getElementById('filter_coach')?.value || "") : (State.loginUser?.nombre || "");
            const colF = document.getElementById('filter_colegio')?.value || ""; 
            const tallerF = document.getElementById('filter_taller')?.value || "";
            const calF = document.getElementById('filter_calendario')?.value || ""; 
            const clasF = document.getElementById('filter_clasificacion')?.value || "";
            const lineaNodes = document.querySelectorAll('.linea-cb:checked'); const lineasF = lineaNodes ? Array.from(lineaNodes).map(cb => cb.value) : [];
            const mesNodes = document.querySelectorAll('.mes-cb:checked'); const mesesF = mesNodes ? Array.from(mesNodes).map(cb => parseInt(cb.value)) : [];

            const textSpanMeses = document.getElementById('text_filter_meses');
            if(textSpanMeses) {
                if (mesesF.length === 0) textSpanMeses.textContent = "Todos los meses"; else if (mesesF.length === 1) textSpanMeses.textContent = mesesNombres[mesesF[0]]; else textSpanMeses.textContent = `${mesesF.length} meses seleccionados`;
            }

            let masterFilterGlobal = safeColegios.filter(c => c.colegio !== "[NUEVO COACH SIN COLEGIO]");
            if(regF) masterFilterGlobal = masterFilterGlobal.filter(c => c.regional === regF);
            if(colF) masterFilterGlobal = masterFilterGlobal.filter(c => c.colegio === colF);
            if(calF) masterFilterGlobal = masterFilterGlobal.filter(c => c.calendario && c.calendario.trim().toUpperCase() === calF);
            if(clasF) masterFilterGlobal = masterFilterGlobal.filter(c => c.clasificacion === clasF);
            if(lineasF.length > 0) masterFilterGlobal = masterFilterGlobal.filter(c => c.lineaNegocio && lineasF.includes(c.lineaNegocio.trim()));
            
            const colegiosPermitidosGlobal = new Set(masterFilterGlobal.map(c => (c.colegio || "").trim().toUpperCase()));

            let dataGlobal = safeEncuestas.map(d => { 
                const colInfo = safeColegios.find(c => (c.colegio || "").toUpperCase() === (d.colegio || "").toUpperCase()); 
                return { ...d, regional: d.regional || (colInfo ? colInfo.regional : 'Sin Regional') }; 
            });

            dataGlobal = dataGlobal.filter(d => {
                if (!colegiosPermitidosGlobal.has((d.colegio || "").trim().toUpperCase())) return false;
                if (regF && d.regional !== regF) return false;
                if (tallerF && d.numTaller !== tallerF) return false;
                if (mesesF.length > 0) {
                    let dateObj = null;
                    if (d.timestamp) { dateObj = new Date(d.timestamp); } 
                    else if (d.fecha) { dateObj = parseFechaToDate(d.fecha); }
                    if (dateObj && !isNaN(dateObj.getTime()) && !mesesF.includes(dateObj.getMonth())) return false;
                }
                return true;
            });

            let data = [...dataGlobal]; if (coachF) data = data.filter(d => d.coach === coachF);
            let masterFilter = [...masterFilterGlobal]; if (coachF) masterFilter = masterFilter.filter(c => c.coach === coachF);
            
            State.filteredEncuestas = data; 

            // Calcula meta de asistencias (según metasCiclo, excluyendo colegios "PRODUCTO")
            // y asistencias reales para un subconjunto de colegios y encuestas.
            const computeAvance = (colegiosGrupo, encuestasGrupo) => {
                const colegiosCiclo = colegiosGrupo.filter(c => { const clasif = c.clasificacion ? c.clasificacion.toUpperCase().trim() : ''; return !clasif.includes('PRODUCTO'); });
                const nombresColegiosCiclo = new Set(colegiosCiclo.map(c => (c.colegio || "").toUpperCase()));
                let metaAsistencias = 0;
                colegiosCiclo.forEach(c => {
                    const docs = parseInt(c.docentes || c.Docentes || c.DOCENTES) || 0;
                    const clasif = c.clasificacion ? c.clasificacion.toUpperCase().trim() : '';
                    const multiplicador = BusinessRules.metasCiclo[clasif] || 1;
                    metaAsistencias += (docs * multiplicador);
                });
                const asistenciasReales = encuestasGrupo.filter(d => nombresColegiosCiclo.has((d.colegio || "").toUpperCase())).length;
                const avance = metaAsistencias > 0 ? (asistenciasReales / metaAsistencias) * 100 : 0;
                return { metaAsistencias, asistenciasReales, avance };
            };

            const metaAlcance = masterFilter.reduce((s, c) => s + (parseInt(c.docentes || c.Docentes || c.DOCENTES) || 0), 0);
            const avanceGlobal = computeAvance(masterFilter, data);
            const metaAsistencias = avanceGlobal.metaAsistencias;
            const asistenciasReales = avanceGlobal.asistenciasReales;
            const avanceCiclo = metaAsistencias > 0 ? avanceGlobal.avance.toFixed(1) : 0;

            const docs = data.filter(d => d.perfil === 'Docente').length; const dirs = data.filter(d => d.perfil === 'Directivo').length;
            
            if(document.getElementById('dash_docentes')) document.getElementById('dash_docentes').innerText = docs; 
            if(document.getElementById('dash_meta_docentes')) document.getElementById('dash_meta_docentes').innerText = metaAlcance === 0 ? "0" : metaAlcance;
            if(document.getElementById('dash_avance_porcentaje')) document.getElementById('dash_avance_porcentaje').innerText = avanceCiclo + '%'; 
            if(document.getElementById('dash_asistencias_reales')) document.getElementById('dash_asistencias_reales').innerText = asistenciasReales;
            if(document.getElementById('dash_asistencias_meta')) document.getElementById('dash_asistencias_meta').innerText = metaAsistencias === 0 ? "0" : metaAsistencias;
            if(document.getElementById('dash_directivos')) document.getElementById('dash_directivos').innerText = dirs;
            if(document.getElementById('dash_cobertura_colegios')) document.getElementById('dash_cobertura_colegios').innerText = new Set(data.map(d => (d.colegio || "").toUpperCase())).size; 
            if(document.getElementById('dash_total_colegios')) document.getElementById('dash_total_colegios').innerText = masterFilter.length;

            // --- Asistencia promedio por regional (gráfica de barras) ---
            // Por regional: promedio de (docentes encuestados por colegio) / promedio de (docentes asignados por colegio),
            // considerando solo colegios atendidos (con al menos 1 encuesta) dentro de los filtros aplicados.
            const asistenciaChartEl = document.getElementById('chart_regional_asistencia');
            if (asistenciaChartEl) {
                const encuestasPorColegio = {};
                data.forEach(d => { const key = (d.colegio || "").trim().toUpperCase(); encuestasPorColegio[key] = (encuestasPorColegio[key] || 0) + 1; });

                const porRegional = {};
                masterFilter.forEach(c => {
                    const key = (c.colegio || "").trim().toUpperCase();
                    const encuestados = encuestasPorColegio[key] || 0;
                    if (encuestados === 0) return; // solo colegios atendidos
                    const docentesAsignados = parseInt(c.docentes || c.Docentes || c.DOCENTES) || 0;
                    const reg = c.regional || 'Sin Regional';
                    if (!porRegional[reg]) porRegional[reg] = { sumEncuestados: 0, sumAsignados: 0, count: 0 };
                    porRegional[reg].sumEncuestados += encuestados;
                    porRegional[reg].sumAsignados += docentesAsignados;
                    porRegional[reg].count++;
                });

                const arrAsist = Object.keys(porRegional).map(k => {
                    const g = porRegional[k];
                    const promEncuestados = g.sumEncuestados / g.count;
                    const promAsignados = g.sumAsignados / g.count;
                    const ratio = promAsignados > 0 ? (promEncuestados / promAsignados) * 100 : 0;
                    return { name: k, ratio, promEncuestados, promAsignados };
                }).sort((a,b) => b.ratio - a.ratio);

                if (arrAsist.length === 0) {
                    asistenciaChartEl.innerHTML = '<div class="text-center text-xs text-gray-400 italic py-4">Sin datos.</div>';
                } else {
                    asistenciaChartEl.innerHTML = arrAsist.map(item => {
                        const pct = Math.min(item.ratio, 100).toFixed(0);
                        const color = item.ratio >= 80 ? '#16a34a' : item.ratio >= 40 ? '#FF5A00' : '#dc2626';
                        return `<div><div class="flex justify-between text-xs font-bold mb-1.5 text-gray-600"><span>${escapeHtml(item.name)}</span><span style="color:${color}">${item.ratio.toFixed(0)}% <span class="text-gray-400 font-normal">(${item.promEncuestados.toFixed(1)} / ${item.promAsignados.toFixed(1)})</span></span></div><div class="w-full bg-gray-100 rounded-full h-2.5"><div class="h-2.5 rounded-full transition-all duration-1000" style="width:${pct}%;background-color:${color}"></div></div></div>`;
                    }).join('');
                }
            }

            const calc = (key) => { let sum = 0, count = 0; data.forEach(d => { const val = getQVal(d, key); if (!isNaN(val)) { sum += val; count++; } }); return count === 0 ? "0.0" : (sum / count).toFixed(1); };
            ['q6', 'q7', 'q8', 'q9'].forEach(q => { const val = calc(q); const avgEl = document.getElementById(`avg_${q}`); const barEl = document.getElementById(`bar_${q}`); if(avgEl) avgEl.innerText = val; if(barEl) barEl.style.width = (val / 5 * 100) + '%'; });

            // --- Punto 2: Satisfacción promedio por regional (gráfica de barras) ---
            const regionalChartEl = document.getElementById('chart_regional_satisfaccion');
            if (regionalChartEl) {
                const porRegional = {};
                data.forEach(d => {
                    const reg = d.regional || 'Sin Regional';
                    let sum = 0, count = 0;
                    ['q6', 'q7', 'q8', 'q9'].forEach(q => { const s = getQVal(d, q); if(!isNaN(s)){ sum += s; count++; } });
                    if (count > 0) { if(!porRegional[reg]) porRegional[reg] = { sum: 0, count: 0 }; porRegional[reg].sum += (sum / count); porRegional[reg].count++; }
                });
                const arrReg = Object.keys(porRegional).map(k => ({ name: k, score: porRegional[k].sum / porRegional[k].count })).sort((a,b) => b.score - a.score);
                if (arrReg.length === 0) {
                    regionalChartEl.innerHTML = '<div class="text-center text-xs text-gray-400 italic py-4">Sin datos.</div>';
                } else {
                    regionalChartEl.innerHTML = arrReg.map(item => {
                        const pct = (item.score / 5 * 100).toFixed(0);
                        const color = item.score >= 4.5 ? '#16a34a' : item.score >= 4.0 ? '#FF5A00' : '#dc2626';
                        return `<div><div class="flex justify-between text-xs font-bold mb-1.5 text-gray-600"><span>${item.name}</span><span style="color:${color}">${item.score.toFixed(1)}</span></div><div class="w-full bg-gray-100 rounded-full h-2.5"><div class="h-2.5 rounded-full transition-all duration-1000" style="width:${pct}%;background-color:${color}"></div></div></div>`;
                    }).join('');
                }
            }

            const buildRanking = (keyProp, dataset, colegiosDataset) => {
                const rankMap = {};
                dataset.forEach(d => { 
                    if(!d[keyProp]) return; 
                    let sum = 0, count = 0;
                    ['q6', 'q7', 'q8', 'q9'].forEach(q => { const s = getQVal(d, q); if(!isNaN(s)){ sum += s; count++; } });
                    if(count > 0){ if(!rankMap[d[keyProp]]) rankMap[d[keyProp]] = { sum: 0, count: 0 }; rankMap[d[keyProp]].sum += (sum / count); rankMap[d[keyProp]].count++; }
                });

                // Agrupar colegios por la misma clave (coach o regional) para calcular cobertura.
                const colegiosPorGrupo = {};
                colegiosDataset.forEach(c => {
                    const key = keyProp === 'coach' ? c.coach : c.regional;
                    if (!key) return;
                    if (!colegiosPorGrupo[key]) colegiosPorGrupo[key] = [];
                    colegiosPorGrupo[key].push(c);
                });

                const arr = Object.keys(rankMap).map(k => {
                    const promedioReal = rankMap[k].sum / rankMap[k].count;
                    const colegiosGrupo = colegiosPorGrupo[k] || [];
                    const colegiosAsignados = new Set(colegiosGrupo.map(c => (c.colegio || "").trim().toUpperCase()));
                    const colegiosEncuestados = new Set(
                        dataset.filter(d => d[keyProp] === k).map(d => (d.colegio || "").trim().toUpperCase())
                    );
                    // Solo contar como "encuestado" un colegio que efectivamente está en la cartera asignada de este grupo.
                    let encuestadosEnCartera = 0;
                    colegiosAsignados.forEach(c => { if (colegiosEncuestados.has(c)) encuestadosEnCartera++; });
                    const cobertura = colegiosAsignados.size > 0 ? (encuestadosEnCartera / colegiosAsignados.size) * 100 : 0;
                    return { name: k, score: promedioReal, count: rankMap[k].count, cobertura, colegiosEncuestados: encuestadosEnCartera, colegiosAsignados: colegiosAsignados.size };
                }).filter(x => x.count > 0).sort((a,b) => {
                    if (b.cobertura !== a.cobertura) return b.cobertura - a.cobertura;
                    return b.score - a.score;
                });

                if (arr.length === 0) return '<tr><td colspan="3" class="text-center text-xs text-gray-400 italic py-4">Sin datos.</td></tr>';
                let html = '';
                arr.slice(0, 10).forEach((item) => {
                    const coberturaTxt = item.cobertura.toFixed(0) + '%';
                    const coberturaColor = item.cobertura >= 80 ? 'text-green-700 bg-green-50' : item.cobertura >= 40 ? 'text-amber-700 bg-amber-50' : 'text-red-700 bg-red-50';
                    html += `<tr class="border-b border-gray-50 hover:bg-gray-50">
                        <td class="py-2 font-bold text-gray-700 truncate max-w-[120px]">${escapeHtml(item.name)}</td>
                        <td class="py-2 text-center font-bold text-gray-600">${item.score.toFixed(1)}</td>
                        <td class="py-2 text-right"><span class="${coberturaColor} px-1.5 py-0.5 rounded font-bold">${coberturaTxt}</span> <span class="text-gray-400 text-[10px]">(${item.colegiosEncuestados}/${item.colegiosAsignados})</span></td>
                    </tr>`;
                });
                return html;
            };

            const rankCoachEl = document.getElementById('ranking_list_coach');
            const rankCoachSubtitle = document.getElementById('rank_coach_subtitle');
            if (rankCoachEl) {
                if (State.currentUserRole === 'admin') {
                    if (coachF) {
                        // Con un coach específico seleccionado, el ranking de coaches no aporta información nueva.
                        rankCoachEl.innerHTML = '<tr><td colspan="3" class="text-center text-xs text-gray-400 italic py-4">Selecciona "Todos" en el filtro de coach para ver el ranking comparativo.</td></tr>';
                        if (rankCoachSubtitle) rankCoachSubtitle.textContent = 'No disponible: hay un coach específico seleccionado en los filtros.';
                    } else {
                        rankCoachEl.innerHTML = buildRanking('coach', data, masterFilterGlobal);
                        if (rankCoachSubtitle) rankCoachSubtitle.textContent = 'Ordenado por % de cobertura (colegios encuestados / asignados); en caso de empate, por promedio de calificación.';
                    }
                } else {
                    rankCoachEl.innerHTML = '<tr><td colspan="3" class="text-center text-xs text-gray-400 italic py-4">No disponible en la vista de coach.</td></tr>';
                    if (rankCoachSubtitle) rankCoachSubtitle.textContent = '';
                }
            }
            const rankRegEl = document.getElementById('ranking_list_regional');
            const rankRegSubtitle = document.getElementById('rank_regional_subtitle');
            if(rankRegEl) rankRegEl.innerHTML = buildRanking('regional', dataGlobal, masterFilterGlobal);
            if(rankRegSubtitle) rankRegSubtitle.textContent = (coachF ? 'Sin filtrar por coach. ' : '') + 'Ordenado por % de cobertura (colegios encuestados / asignados); en caso de empate, por promedio de calificación.';


            const detractores = data.filter(d => { const scores = ['q6','q7','q8','q9'].map(q => getQVal(d, q)).filter(s => !isNaN(s)); return scores.some(s => s <= 2); });
            State.detractoresActuales = detractores;
            const detBadge = document.getElementById('detractores_badge');
            if(detBadge) detBadge.innerText = `${detractores.length}`;
            const dList = document.getElementById('detractores_list');
            
            if (dList) {
                if (detractores.length === 0) { dList.innerHTML = '<div class="text-center text-green-600 py-6 font-bold">¡Sin alertas críticas!</div>'; } 
                else {
                    let detractoresHTML = '';
                    detractores.slice(0, 5).forEach(d => {
                        const scores = ['q6','q7','q8','q9'].map(q => getQVal(d, q)).filter(s => !isNaN(s));
                        const minScore = scores.length > 0 ? Math.min(...scores) : 'N/A';
                        const f = formatFechaDisplay(d);
                        if (State.currentUserRole === 'admin') {
                            detractoresHTML += `<div class="p-4 bg-red-50 rounded-xl border border-red-100 flex flex-col gap-3"><div class="flex items-start gap-3"><span class="w-8 h-8 flex items-center justify-center bg-red-600 text-white rounded-lg text-sm font-black shadow-sm shrink-0">${minScore}</span><div class="flex-1 min-w-0"><p class="font-bold text-red-900 text-xs truncate">${escapeHtml(d.colegio)}</p><div class="flex flex-col mt-1 gap-1"><p class="text-[10px] text-red-700 truncate"><i class="fa-solid fa-chalkboard-user mr-1 opacity-70"></i> ${escapeHtml(d.asistente || 'Anónimo')}</p><p class="text-[10px] font-bold text-gray-700 truncate"><i class="fa-solid fa-user-tie mr-1 opacity-70"></i> Coach: ${escapeHtml(d.coach)}</p></div></div></div></div>`;
                        } else {
                            detractoresHTML += `<div class="p-4 bg-red-50 rounded-xl border border-red-100 flex flex-col gap-3"><div class="flex items-center gap-3"><span class="w-8 h-8 flex items-center justify-center bg-red-600 text-white rounded-lg text-sm font-black shadow-sm shrink-0">${minScore}</span><div class="flex-1 min-w-0"><p class="font-bold text-red-900 text-xs truncate">${escapeHtml(d.colegio)}</p><p class="text-[9px] text-red-700 mt-0.5">${f}</p></div></div></div>`;
                        }
                    });
                    if (detractores.length > 5) {
                        detractoresHTML += `<div class="text-center text-xs font-bold text-red-600 py-2">+ ${detractores.length - 5} más — clic para ver el detalle completo</div>`;
                    }
                    dList.innerHTML = detractoresHTML;
                }
            }
            this.renderRegistrosTable(true);
        } catch (err) {
            console.error("Error dibujando el dashboard:", err);
            const errBanner = document.getElementById('dash_error_banner');
            const errDetail = document.getElementById('dash_error_detail');
            if (errDetail) errDetail.textContent = `(${err?.message || 'error desconocido'})`;
            if (errBanner) errBanner.classList.remove('hidden');
        }
    },

    // --- ACCIONES MASIVAS ---
    toggleSelectAll: function() {
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        const isChecked = selectAllCheckbox ? selectAllCheckbox.checked : false;
        State.registrosFiltrados.forEach(d => { if(isChecked) State.selectedRegistros.add(d.id); else State.selectedRegistros.delete(d.id); });
        document.querySelectorAll('.row-checkbox').forEach(cb => { cb.checked = isChecked; });
        this.updateBulkActionBar();
    },

    toggleRowSelection: function(id, isChecked) {
        if(isChecked) State.selectedRegistros.add(id); else State.selectedRegistros.delete(id);
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        if(selectAllCheckbox && !isChecked) selectAllCheckbox.checked = false;
        this.updateBulkActionBar();
    },

    updateBulkActionBar: function() {
        const bar = document.getElementById('bulk_action_bar'); const countSpan = document.getElementById('bulk_count');
        if(!bar || !countSpan) return;
        if(State.selectedRegistros.size > 0 && State.currentUserRole === 'admin') { countSpan.innerText = State.selectedRegistros.size; bar.classList.remove('hidden'); } 
        else { bar.classList.add('hidden'); }
    },

    bulkDelete: async function() {
        if(State.currentUserRole !== 'admin') return;
        const count = State.selectedRegistros.size; if(count === 0) return;
        if(!confirm(`⚠️ PELIGRO: Vas a eliminar ${count} encuestas simultáneamente.\nEsta acción NO se puede deshacer.\n¿Deseas continuar?`)) return;

        try {
            const arrIds = Array.from(State.selectedRegistros);
            const deletePromises = arrIds.map(id => deleteDoc(doc(db, "encuestas", id)));
            await Promise.all(deletePromises);

            State.encuestasData = State.encuestasData.filter(d => !State.selectedRegistros.has(d.id));
            State.selectedRegistros.clear();
            const selectAllCheckbox = document.getElementById('selectAllCheckbox'); if(selectAllCheckbox) selectAllCheckbox.checked = false;
            this.updateBulkActionBar(); this.updateDashboard(); 
            alert(`✅ ${count} registros eliminados exitosamente.`);
        } catch(e) { alert("Error al realizar la eliminación masiva."); console.error(e); }
    },

    openBulkEditModal: function() {
        if(State.currentUserRole !== 'admin') return;
        const count = State.selectedRegistros.size; if(count === 0) return;

        let coachOptions = '<option value="">(No modificar este campo)</option>'; 
        const safeCoaches = Array.isArray(State.coachesAuth) ? State.coachesAuth : [];
        [...new Set(safeCoaches.map(c => c.nombre))].sort().forEach(c => coachOptions += `<option value="${c}">${c}</option>`);

        let colOptions = '<option value="">(No modificar este campo)</option>'; 
        const safeColegios = Array.isArray(State.colegiosBD) ? State.colegiosBD : [];
        [...new Set(safeColegios.map(c => c.colegio))].sort().forEach(c => colOptions += `<option value="${c}">${c}</option>`);

        let regOptions = '<option value="">(No modificar este campo)</option>'; 
        [...new Set(safeColegios.map(c => c.regional).filter(Boolean))].sort().forEach(r => regOptions += `<option value="${r}">${r}</option>`);

        this.showModal(`Edición Masiva (${count} registros)`, `
            <div class="space-y-4">
                <p class="text-xs text-blue-600 mb-4 bg-blue-50 p-3 rounded-lg border border-blue-100">
                    <i class="fa-solid fa-circle-info mr-1"></i> Selecciona únicamente los campos que deseas cambiar para las <b>${count}</b> encuestas.
                </p>
                <div class="grid grid-cols-1 gap-4">
                    <div><label class="text-xs font-bold text-gray-600">Cambiar Colegio a:</label><select id="bulk_edit_colegio" class="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm">${colOptions}</select></div>
                    <div><label class="text-xs font-bold text-gray-600">Cambiar Coach asignado a:</label><select id="bulk_edit_coach" class="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm">${coachOptions}</select></div>
                    <div><label class="text-xs font-bold text-gray-600">Sobrescribir Regional a:</label><select id="bulk_edit_regional" class="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm">${regOptions}</select></div>
                    <div><label class="text-xs font-bold text-gray-600">Cambiar Perfil del asistente a:</label><select id="bulk_edit_perfil" class="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm"><option value="">(No modificar este campo)</option><option value="Docente">Docente</option><option value="Directivo">Directivo</option></select></div>
                </div>
            </div>
        `, `<button type="button" onclick="App.hideModal()" class="px-6 py-2.5 bg-gray-200 text-gray-700 rounded-xl font-bold">Cancelar</button>
            <button type="button" onclick="App.saveBulkEdit()" class="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-md"><i class="fa-solid fa-bolt mr-2"></i>Aplicar Cambios</button>`);
    },

    saveBulkEdit: async function() {
        const btn = event.target; btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Procesando...';

        const nuevoColegio = document.getElementById('bulk_edit_colegio').value;
        const nuevoCoach = document.getElementById('bulk_edit_coach').value;
        const nuevoPerfil = document.getElementById('bulk_edit_perfil').value;
        const nuevaRegional = document.getElementById('bulk_edit_regional').value;

        if(!nuevoColegio && !nuevoCoach && !nuevoPerfil && !nuevaRegional) { alert("No seleccionaste ningún campo para modificar."); btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-bolt mr-2"></i>Aplicar Cambios'; return; }

        const dataActualizada = {};
        if (nuevoColegio) dataActualizada.colegio = nuevoColegio; 
        if (nuevoCoach) dataActualizada.coach = nuevoCoach; 
        if (nuevoPerfil) dataActualizada.perfil = nuevoPerfil;
        if (nuevaRegional) dataActualizada.regional = nuevaRegional;

        try {
            const arrIds = Array.from(State.selectedRegistros);
            const updatePromises = arrIds.map(id => setDoc(doc(db, "encuestas", id), dataActualizada, { merge: true }));
            await Promise.all(updatePromises);

            arrIds.forEach(id => { const index = State.encuestasData.findIndex(d => d.id === id); if(index !== -1) { State.encuestasData[index] = { ...State.encuestasData[index], ...dataActualizada }; } });

            State.selectedRegistros.clear(); const selectAllCheckbox = document.getElementById('selectAllCheckbox'); if(selectAllCheckbox) selectAllCheckbox.checked = false;
            this.hideModal(); this.updateBulkActionBar(); this.updateDashboard();
            alert(`✅ Edición aplicada correctamente a ${arrIds.length} registros.`);
        } catch (error) { alert("Hubo un error al guardar masivamente."); console.error(error); btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-bolt mr-2"></i>Aplicar Cambios'; }
    },
    // --- FIN BULK ACTIONS ---

    // --- ORDENAMIENTO (A-Z) ---
    setSort: function(col) {
        if (State.regSort.col === col) {
            State.regSort.dir = State.regSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
            State.regSort.col = col;
            State.regSort.dir = 'asc';
        }
        this.renderRegistrosTable(true);
    },

    populateRegistrosFilters: function() {
        const regSel = document.getElementById('reg_filter_regional'); 
        const colSel = document.getElementById('reg_filter_colegio'); 
        const coachSel = document.getElementById('reg_filter_coach'); 
        const tallerSel = document.getElementById('reg_filter_taller');
        if (!colSel) return;

        const regVal = regSel.value || ""; const colVal = colSel.value || "";
        const coachVal = State.currentUserRole === 'admin' ? (coachSel.value || "") : (State.loginUser?.nombre || "");

        const safeEncuestas = Array.isArray(State.encuestasData) ? State.encuestasData : [];
        const safeColegios = Array.isArray(State.colegiosBD) ? State.colegiosBD : [];
        
        const datosEnriquecidos = safeEncuestas.map(d => { 
            const col = safeColegios.find(c => (c.colegio || "").toUpperCase() === (d.colegio || "").toUpperCase()); 
            return { ...d, regional: d.regional || (col ? col.regional : 'Sin Regional') }; 
        });

        const getFilteredExcluding = (exclude) => {
            return datosEnriquecidos.filter(d => {
                if (exclude !== 'regional' && regVal && d.regional !== regVal) return false;
                if (exclude !== 'coach' && coachVal && d.coach !== coachVal) return false;
                if (exclude !== 'colegio' && colVal && d.colegio !== colVal) return false;
                return true;
            });
        };

        const updateSelect = (el, validData, currVal, text) => { 
            if(el) { el.innerHTML = `<option value="">${text}</option>`; validData.forEach(v => el.innerHTML += `<option value="${v}">${v}</option>`); if (validData.includes(currVal)) el.value = currVal; else el.value = ""; } 
        };

        updateSelect(regSel, [...new Set(getFilteredExcluding('regional').map(d => d.regional).filter(Boolean))].sort(), regVal, "Todas");
        updateSelect(colSel, [...new Set(getFilteredExcluding('colegio').map(d => d.colegio).filter(Boolean))].sort(), colVal, "Todos los Colegios");
        if (State.currentUserRole === 'admin') { updateSelect(coachSel, [...new Set(getFilteredExcluding('coach').map(d => d.coach).filter(Boolean))].sort(), coachVal, "Todos los Coaches"); } 
        else if(coachSel) { coachSel.innerHTML = `<option value="${State.loginUser.nombre}">${State.loginUser.nombre}</option>`; coachSel.disabled = true; }
        
        if (tallerSel) { const tallVal = tallerSel.value || ""; updateSelect(tallerSel, [...new Set(getFilteredExcluding('taller').map(d => d.numTaller).filter(Boolean))].sort(), tallVal, "Todos los Talleres"); }
    },

    renderRegistrosTable: function(resetPagination = true) {
        if (resetPagination) State.currentRendered = 0;

        this.populateRegistrosFilters();
        const fechaVal = document.getElementById('reg_filter_fecha')?.value; 
        const regVal = document.getElementById('reg_filter_regional')?.value;
        const colVal = document.getElementById('reg_filter_colegio')?.value; 
        const tallerVal = document.getElementById('reg_filter_taller')?.value;
        const coachVal = document.getElementById('reg_filter_coach')?.value;
        const perfilVal = document.getElementById('reg_filter_perfil')?.value; 
        
        const safeEncuestas = Array.isArray(State.encuestasData) ? State.encuestasData : [];
        const safeColegios = Array.isArray(State.colegiosBD) ? State.colegiosBD : [];
        
        let data = safeEncuestas.map(d => { 
            const col = safeColegios.find(c => (c.colegio || "").toUpperCase() === (d.colegio || "").toUpperCase()); 
            return { ...d, regional: d.regional || (col ? col.regional : 'Sin Regional') }; 
        });
        
        if (fechaVal) {
            const p = fechaVal.split('-'); // YYYY-MM-DD del input type=date
            const selYear = parseInt(p[0]), selMonth = parseInt(p[1]) - 1, selDay = parseInt(p[2]);
            data = data.filter(d => {
                let dateObj = null;
                if (d.timestamp) { dateObj = new Date(d.timestamp); }
                else if (d.fecha) { dateObj = parseFechaToDate(d.fecha); }
                if (!dateObj || isNaN(dateObj.getTime())) return false;
                return dateObj.getFullYear() === selYear && dateObj.getMonth() === selMonth && dateObj.getDate() === selDay;
            });
        }
        if (regVal) data = data.filter(d => d.regional === regVal); 
        if (colVal) data = data.filter(d => d.colegio === colVal);
        if (tallerVal) data = data.filter(d => d.numTaller === tallerVal); 
        if (perfilVal) data = data.filter(d => d.perfil === perfilVal);
        if (coachVal && State.currentUserRole === 'admin') data = data.filter(d => d.coach === coachVal);
        if (State.currentUserRole === 'coach') data = data.filter(d => d.coach === State.loginUser.nombre);
        
        // Aplicar Ordenamiento A-Z
        data.sort((a, b) => {
            let valA = a[State.regSort.col] || '';
            let valB = b[State.regSort.col] || '';
            
            if (State.regSort.col === 'timestamp') {
                valA = a.timestamp || 0; valB = b.timestamp || 0;
                return State.regSort.dir === 'asc' ? valA - valB : valB - valA;
            }

            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();

            if (valA < valB) return State.regSort.dir === 'asc' ? -1 : 1;
            if (valA > valB) return State.regSort.dir === 'asc' ? 1 : -1;
            return 0;
        });

        State.registrosFiltrados = data;

        const tBody = document.getElementById('tabla_registros'); 
        const tHead = document.getElementById('tabla_registros_head');
        if(!tBody || !tHead) return;
        
        if (resetPagination) tBody.innerHTML = '';
        
        // DIBUJAR CABECERAS ORDENABLES
        const getSortIcon = (col) => {
            if (State.regSort.col !== col) return '<i class="fa-solid fa-sort ml-1 opacity-30"></i>';
            return State.regSort.dir === 'asc' ? '<i class="fa-solid fa-sort-up ml-1 text-[#FF5A00]"></i>' : '<i class="fa-solid fa-sort-down ml-1 text-[#FF5A00]"></i>';
        };

        tHead.innerHTML = `<tr>
            ${State.currentUserRole === 'admin' ? '<th class="px-6 py-4 w-10 text-center col-admin-only"><input type="checkbox" id="selectAllCheckbox" class="cursor-pointer w-4 h-4 accent-[#FF5A00] rounded" onchange="App.toggleSelectAll()" title="Seleccionar todos"></th>' : ''}
            <th class="px-6 py-4">Fecha</th>
            <th class="px-6 py-4 cursor-pointer hover:bg-gray-200 transition-colors select-none" onclick="App.setSort('colegio')">Colegio ${getSortIcon('colegio')}</th>
            <th class="px-6 py-4">Taller</th>
            ${State.currentUserRole === 'admin' ? `<th class="px-6 py-4 cursor-pointer hover:bg-gray-200 transition-colors select-none col-admin-only" onclick="App.setSort('asistente')">Asistente ${getSortIcon('asistente')}</th>` : ''}
            <th class="px-6 py-4">Perfil</th>
            <th class="px-6 py-4 cursor-pointer hover:bg-gray-200 transition-colors select-none" onclick="App.setSort('coach')">Coach ${getSortIcon('coach')}</th>
            <th class="px-6 py-4 text-center">Promedio</th>
            <th class="px-6 py-4 min-w-[250px]">Sugerencias</th>
            ${State.currentUserRole === 'admin' ? '<th class="px-6 py-4 text-center col-admin-only">Acciones</th>' : ''}
        </tr>`;

        const masterCb = document.getElementById('selectAllCheckbox');
        if(masterCb && State.selectedRegistros.size > 0 && State.selectedRegistros.size >= data.length) { masterCb.checked = true; }

        const paginationContainer = document.getElementById('pagination_container');

        if (data.length === 0) { 
            tBody.innerHTML = `<tr><td colspan="10" class="px-6 py-8 text-center text-gray-400 italic">No hay registros para mostrar.</td></tr>`; 
            if(paginationContainer) paginationContainer.classList.add('hidden');
            return; 
        }

        const template = document.getElementById('row-template');
        if(!template) return;
        
        const nextBatch = data.slice(State.currentRendered, State.currentRendered + State.paginationLimit);

        nextBatch.forEach(d => {
            const clone = template.content.cloneNode(true);
            
            let sum = 0, count = 0;
            ['q6', 'q7', 'q8', 'q9'].forEach(q => { const s = getQVal(d, q); if(!isNaN(s)){ sum += s; count++; } });
            const avg = count > 0 ? (sum / count).toFixed(1) : '-';
            let f = formatFechaDisplay(d);

            const cb = clone.querySelector('.row-checkbox');
            if(cb) { cb.checked = State.selectedRegistros.has(d.id); cb.onchange = (e) => App.toggleRowSelection(d.id, e.target.checked); }

            clone.querySelector('.t-fecha').textContent = f;
            clone.querySelector('.t-colegio').textContent = d.colegio;
            clone.querySelector('.t-regional').textContent = d.regional;
            clone.querySelector('.t-taller').textContent = `${d.numTaller}: ${d.taller}`;
            clone.querySelector('.t-asistente').textContent = d.asistente || 'Anónimo';
            clone.querySelector('.t-perfil').textContent = d.perfil;
            clone.querySelector('.t-coach').textContent = d.coach;
            
            const badge = clone.querySelector('.t-promedio');
            badge.textContent = avg;
            if (avg >= 4.0) badge.className += ' text-green-700 bg-green-50'; else if (avg >= 3.0) badge.className += ' text-yellow-700 bg-yellow-50'; else badge.className += ' text-red-700 bg-red-50';

            clone.querySelector('.t-sugerencias').textContent = d.sugerencias || 'Sin comentarios';

            const btnEdit = clone.querySelector('.btn-edit'); const btnDelete = clone.querySelector('.btn-delete');
            if(btnEdit) btnEdit.onclick = () => App.openEditRegistroModal(d.id);
            if(btnDelete) btnDelete.onclick = () => App.deleteRegistroIndividual(d.id);

            if(State.currentUserRole !== 'admin') { clone.querySelectorAll('.col-admin-only').forEach(col => col.style.display = 'none'); }

            tBody.appendChild(clone);
        });

        State.currentRendered += nextBatch.length;
        const remaining = data.length - State.currentRendered;

        if(paginationContainer) {
            if (remaining > 0) { paginationContainer.classList.remove('hidden'); document.getElementById('count_restantes').textContent = remaining; } 
            else { paginationContainer.classList.add('hidden'); }
        }
    },

    loadMoreRegistros: function() { this.renderRegistrosTable(false); },

    deleteRegistroIndividual: async function(id) {
        if(State.currentUserRole !== 'admin') return alert("Acceso denegado.");
        if(!confirm("¿Estás seguro que deseas ELIMINAR este registro de la base de datos?")) return;
        try {
            await deleteDoc(doc(db, "encuestas", id));
            State.encuestasData = State.encuestasData.filter(d => d.id !== id);
            State.selectedRegistros.delete(id);
            this.updateBulkActionBar(); this.updateDashboard(); 
            alert("Registro eliminado.");
        } catch(e) { alert("Error al eliminar el registro."); console.error(e); }
    },

    openEditRegistroModal: function(id) {
        if(State.currentUserRole !== 'admin') return alert("Acceso denegado.");
        const safeEncuestas = Array.isArray(State.encuestasData) ? State.encuestasData : [];
        const registro = safeEncuestas.find(d => d.id === id);
        if(!registro) return;

        const safeColegios = Array.isArray(State.colegiosBD) ? State.colegiosBD : [];
        
        let coachOptions = '<option value="">Seleccione...</option>'; 
        const safeCoaches = Array.isArray(State.coachesAuth) ? State.coachesAuth : [];
        [...new Set(safeCoaches.map(c => c.nombre))].sort().forEach(c => coachOptions += `<option value="${c}" ${registro.coach === c ? 'selected' : ''}>${c}</option>`);

        let colOptions = '<option value="">Seleccione...</option>'; 
        [...new Set(safeColegios.map(c => c.colegio))].sort().forEach(c => colOptions += `<option value="${c}" ${registro.colegio === c ? 'selected' : ''}>${c}</option>`);

        // Extraer regional actual (si tiene un override en la encuesta, usamos esa, sino la de la DB de colegios)
        const colEncontrado = safeColegios.find(c => (c.colegio || "").toUpperCase() === (registro.colegio || "").toUpperCase());
        const currentRegional = registro.regional || (colEncontrado ? colEncontrado.regional : '');
        let regOptions = '<option value="">Sin Regional</option>';
        [...new Set(safeColegios.map(c => c.regional).filter(Boolean))].sort().forEach(r => regOptions += `<option value="${r}" ${currentRegional === r ? 'selected' : ''}>${r}</option>`);

        this.showModal("Editar Registro", `
            <div class="space-y-4">
                <div class="grid grid-cols-2 gap-4">
                    <div><label class="text-xs font-bold text-gray-500">Colegio</label><select id="edit_reg_colegio" class="w-full border rounded-xl px-3 py-2 text-sm">${colOptions}</select></div>
                    <div><label class="text-xs font-bold text-gray-500">Coach Asignado</label><select id="edit_reg_coach" class="w-full border rounded-xl px-3 py-2 text-sm">${coachOptions}</select></div>
                </div>
                <div class="grid grid-cols-3 gap-4">
                    <div><label class="text-xs font-bold text-gray-500">Regional (Override)</label><select id="edit_reg_regional" class="w-full border rounded-xl px-3 py-2 text-sm">${regOptions}</select></div>
                    <div><label class="text-xs font-bold text-gray-500">Perfil</label>
                    <select id="edit_reg_perfil" class="w-full border rounded-xl px-3 py-2 text-sm">
                        <option value="Docente" ${registro.perfil === 'Docente' ? 'selected' : ''}>Docente</option>
                        <option value="Directivo" ${registro.perfil === 'Directivo' ? 'selected' : ''}>Directivo</option>
                    </select></div>
                    <div><label class="text-xs font-bold text-gray-500">Asistente</label><input type="text" id="edit_reg_asistente" value="${registro.asistente || ''}" class="w-full border rounded-xl px-3 py-2 text-sm"></div>
                </div>
                <div class="grid grid-cols-4 gap-2 border-t pt-4">
                    <div><label class="text-[10px] font-bold text-gray-500">Q6</label><input type="number" id="edit_reg_q6" value="${registro.q6 || ''}" max="5" min="1" class="w-full border rounded-lg px-2 py-1 text-sm text-center"></div>
                    <div><label class="text-[10px] font-bold text-gray-500">Q7</label><input type="number" id="edit_reg_q7" value="${registro.q7 || ''}" max="5" min="1" class="w-full border rounded-lg px-2 py-1 text-sm text-center"></div>
                    <div><label class="text-[10px] font-bold text-gray-500">Q8</label><input type="number" id="edit_reg_q8" value="${registro.q8 || ''}" max="5" min="1" class="w-full border rounded-lg px-2 py-1 text-sm text-center"></div>
                    <div><label class="text-[10px] font-bold text-gray-500">Q9</label><input type="number" id="edit_reg_q9" value="${registro.q9 || ''}" max="5" min="1" class="w-full border rounded-lg px-2 py-1 text-sm text-center"></div>
                </div>
            </div>
        `, `<button type="button" onclick="App.hideModal()" class="px-6 py-2 bg-gray-200 rounded-xl font-bold">Cancelar</button><button type="button" onclick="App.saveEditRegistroIndividual('${id}')" class="px-6 py-2 bg-[#FF5A00] text-white rounded-xl font-bold shadow-md">Guardar Cambios</button>`);
    },

    saveEditRegistroIndividual: async function(id) {
        if(State.currentUserRole !== 'admin') return alert("Acceso denegado.");

        const btn = event.target; btn.disabled = true; btn.innerText = "Guardando...";
        const dataActualizada = { 
            colegio: document.getElementById('edit_reg_colegio').value, 
            coach: document.getElementById('edit_reg_coach').value, 
            regional: document.getElementById('edit_reg_regional').value, 
            perfil: document.getElementById('edit_reg_perfil').value, 
            asistente: document.getElementById('edit_reg_asistente').value, 
            q6: parseFloat(document.getElementById('edit_reg_q6').value) || 0, 
            q7: parseFloat(document.getElementById('edit_reg_q7').value) || 0, 
            q8: parseFloat(document.getElementById('edit_reg_q8').value) || 0, 
            q9: parseFloat(document.getElementById('edit_reg_q9').value) || 0 
        };

        try {
            await setDoc(doc(db, "encuestas", id), dataActualizada, { merge: true });
            const index = State.encuestasData.findIndex(d => d.id === id);
            if(index !== -1) State.encuestasData[index] = { ...State.encuestasData[index], ...dataActualizada };
            this.hideModal(); this.updateDashboard(); alert("Cambio guardado.");
        } catch (error) { alert("Error al guardar."); console.error(error); btn.disabled = false; btn.innerText = "Guardar Cambios"; }
    },

    exportToExcel: function() {
        const list = State.registrosFiltrados && State.registrosFiltrados.length > 0 ? State.registrosFiltrados : State.filteredEncuestas;
        if (!list || list.length === 0) { alert("No hay datos para exportar."); return; }
        const data = list.map(d => {
            let f = formatFechaDisplay(d);
            return { id: d.id, fecha: f, ciclo: d.ciclo, regional: d.regional || 'Sin Regional', colegio: d.colegio, asistente: d.asistente, perfil: d.perfil, coach: d.coach, numTaller: d.numTaller, taller: d.taller, q6: d.q6, q7: d.q7, q8: d.q8, q9: d.q9, sugerencias: d.sugerencias };
        });
        const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Reporte"); XLSX.writeFile(wb, "Reporte_Encuestas_Santillana.xlsx");
    },


    // ══════════════════════════════════════════════════════════════════
    // PESTAÑA: AVANCE POR COLEGIO
    // ══════════════════════════════════════════════════════════════════

    _avanceSort: { col: 'avancePct', dir: 'desc' },

    sortAvance: function(col) {
        if (this._avanceSort.col === col) {
            this._avanceSort.dir = this._avanceSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
            this._avanceSort.col = col;
            this._avanceSort.dir = 'desc';
        }
        // Actualizar iconos de ordenamiento
        ['colegio','regional','coach','avancePct','docentes','satisfaccion','talleresRealizados'].forEach(c => {
            const el = document.getElementById('sort-icon-' + c);
            if (!el) return;
            if (c === col) {
                el.className = 'fa-solid ml-1 ' + (this._avanceSort.dir === 'asc' ? 'fa-sort-up text-[#FF5A00]' : 'fa-sort-down text-[#FF5A00]');
            } else {
                el.className = 'fa-solid fa-sort text-gray-300 ml-1';
            }
        });
        this.renderAvanceColegios();
    },

    _buildAvanceData: function() {
        const safeColegios = Array.isArray(State.colegiosBD) ? State.colegiosBD : [];
        const safeEncuestas = Array.isArray(State.encuestasData) ? State.encuestasData : [];
        const isAdmin = State.currentUserRole === 'admin';
        const coachForzado = !isAdmin ? (State.loginUser?.nombre || '') : '';

        const filterCoach = coachForzado || (document.getElementById('avance_filter_coach')?.value || '');
        const filterReg   = document.getElementById('avance_filter_regional')?.value || '';

        // Colegios activos: excluir PRODUCTO, aplicar filtros
        const colegios = safeColegios.filter(c => {
            const clasif = (c.clasificacion || '').toUpperCase().trim();
            if (clasif.includes('PRODUCTO')) return false;
            if (filterCoach && (c.coach || '').trim().toLowerCase() !== filterCoach.trim().toLowerCase()) return false;
            if (filterReg && (c.regional || '') !== filterReg) return false;
            return true;
        });

        return colegios.map(c => {
            const nombreKey = (c.colegio || '').toUpperCase().trim();
            const clasif    = (c.clasificacion || '').toUpperCase().trim();
            const metaTalleres   = BusinessRules.metasCiclo[clasif] || 1;
            const docentes       = parseInt(c.docentes || c.Docentes || c.DOCENTES) || 0;
            const metaAsistencias = docentes * metaTalleres;

            // Encuestas de este colegio
            const encColegio = safeEncuestas.filter(d =>
                (d.colegio || '').toUpperCase().trim() === nombreKey
            );
            const asistenciasReales = encColegio.length;
            const avancePct = metaAsistencias > 0 ? (asistenciasReales / metaAsistencias) * 100 : 0;

            // Talleres distintos realizados (por numTaller)
            const talleresRealizados = new Set(
                encColegio.map(d => (d.numTaller || '').trim()).filter(Boolean)
            ).size;

            // Satisfacción promedio (q6-q9)
            let sumSat = 0, countSat = 0;
            encColegio.forEach(d => {
                ['q6','q7','q8','q9'].forEach(q => {
                    const v = getQVal(d, q);
                    if (!isNaN(v)) { sumSat += v; countSat++; }
                });
            });
            const satisfaccion = countSat > 0 ? sumSat / countSat : null;

            return {
                colegio: c.colegio || '',
                regional: c.regional || '',
                coach: c.coach || '',
                clasificacion: c.clasificacion || '',
                clasifKey: clasif,
                metaTalleres,
                docentes,
                metaAsistencias,
                asistenciasReales,
                avancePct,
                satisfaccion,
                talleresRealizados,
            };
        });
    },

    renderAvanceColegios: function() {
        const safeColegios = Array.isArray(State.colegiosBD) ? State.colegiosBD : [];
        const isAdmin = State.currentUserRole === 'admin';

        // ── Poblar selectores de filtro (solo la primera vez) ──────────
        const coachSel = document.getElementById('avance_filter_coach');
        const regSel   = document.getElementById('avance_filter_regional');

        if (coachSel) {
            if (!isAdmin) {
                coachSel.classList.add('hidden');
            } else if (coachSel.options.length <= 1) {
                const coaches = [...new Set(safeColegios.map(c => c.coach).filter(Boolean))].sort();
                coaches.forEach(c => {
                    const o = document.createElement('option'); o.value = c; o.textContent = c;
                    coachSel.appendChild(o);
                });
            }
        }
        if (regSel && regSel.options.length <= 1) {
            const regs = [...new Set(safeColegios.map(c => c.regional).filter(Boolean))].sort();
            regs.forEach(r => {
                const o = document.createElement('option'); o.value = r; o.textContent = r;
                regSel.appendChild(o);
            });
        }

        // ── Calcular filas ──────────────────────────────────────────────
        let filas = this._buildAvanceData();

        // ── Ordenar ────────────────────────────────────────────────────
        const { col, dir } = this._avanceSort;
        filas.sort((a, b) => {
            let va = a[col], vb = b[col];
            if (va === null || va === undefined) va = dir === 'asc' ? Infinity : -Infinity;
            if (vb === null || vb === undefined) vb = dir === 'asc' ? Infinity : -Infinity;
            if (typeof va === 'string') {
                va = va.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                vb = (vb + '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            }
            if (va < vb) return dir === 'asc' ? -1 : 1;
            if (va > vb) return dir === 'asc' ? 1 : -1;
            return 0;
        });

        // ── Resumen ─────────────────────────────────────────────────────
        const totalColegios  = filas.length;
        const conEncuesta    = filas.filter(f => f.asistenciasReales > 0).length;
        const completados    = filas.filter(f => f.avancePct >= 100).length;
        const totalDocentes  = filas.reduce((s, f) => s + f.docentes, 0);
        const summaryEl = document.getElementById('avance_summary');
        if (summaryEl) {
            summaryEl.innerHTML = [
                { label: 'Colegios activos',   value: totalColegios,          color: 'text-[#002C5F]' },
                { label: 'Con encuestas',       value: conEncuesta + ' / ' + totalColegios, color: 'text-[#FF5A00]' },
                { label: 'Ciclo completado',    value: completados,            color: 'text-green-600' },
                { label: 'Total docentes BD',   value: totalDocentes,          color: 'text-blue-600' },
            ].map(s =>
                '<div class="py-4 px-2">' +
                  '<p class="text-xl font-black ' + s.color + '">' + s.value + '</p>' +
                  '<p class="text-[10px] text-gray-400 uppercase tracking-wide mt-0.5">' + s.label + '</p>' +
                '</div>'
            ).join('');
        }

        // ── Renderizar tabla ────────────────────────────────────────────
        const tbody   = document.getElementById('avance_tbody');
        const emptyEl = document.getElementById('avance_empty');
        if (!tbody) return;

        if (filas.length === 0) {
            tbody.innerHTML = '';
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        }
        if (emptyEl) emptyEl.classList.add('hidden');

        tbody.innerHTML = filas.map(f => {
            const pct      = f.avancePct;
            const pctDisp  = pct.toFixed(1) + '%';
            const barColor = pct >= 100 ? '#16a34a' : pct >= 50 ? '#FF5A00' : '#dc2626';
            const barW     = Math.min(pct, 100).toFixed(0);

            // Columna Avance: solo la barra + %
            const avanceCol =
                '<div class="flex items-center gap-2 min-w-[120px]">' +
                  '<div class="flex-1 bg-gray-100 rounded-full h-2">' +
                    '<div class="h-2 rounded-full transition-all duration-700" style="width:' + barW + '%;background-color:' + barColor + '"></div>' +
                  '</div>' +
                  '<span class="text-xs font-black w-12 text-right" style="color:' + barColor + '">' + pctDisp + '</span>' +
                '</div>';

            // Columna Satisfacción
            const satCol = f.satisfaccion !== null
                ? '<span class="font-bold" style="color:' +
                    (f.satisfaccion >= 4.5 ? '#16a34a' : f.satisfaccion >= 4.0 ? '#FF5A00' : '#dc2626') +
                    '">' + f.satisfaccion.toFixed(2) + '</span>' +
                  '<span class="text-gray-300 text-[10px]"> / 5</span>'
                : '<span class="text-gray-300 text-xs">—</span>';

            // Columna Talleres: "2 / 6"
            const tallCol =
                '<span class="font-bold text-[#002C5F]">' + f.talleresRealizados + '</span>' +
                '<span class="text-gray-400 text-xs"> / ' + f.metaTalleres + '</span>';

            return '<tr class="hover:bg-orange-50 transition-colors">' +
                '<td class="px-4 py-3 font-bold text-[#002C5F] text-xs max-w-[180px]" title="' + escapeHtml(f.colegio) + '">' + escapeHtml(f.colegio) + '</td>' +
                '<td class="px-4 py-3 text-xs text-gray-500">' + escapeHtml(f.regional) + '</td>' +
                '<td class="px-4 py-3 text-xs text-gray-600">' + escapeHtml(f.coach) + '</td>' +
                '<td class="px-4 py-3 text-xs"><span class="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-bold text-[10px]">' + escapeHtml(f.clasificacion) + '</span></td>' +
                '<td class="px-4 py-3">' + avanceCol + '</td>' +
                '<td class="px-4 py-3 text-xs text-center font-bold text-[#002C5F]">' + f.docentes + '</td>' +
                '<td class="px-4 py-3 text-xs">' + satCol + '</td>' +
                '<td class="px-4 py-3 text-xs text-center">' + tallCol + '</td>' +
            '</tr>';
        }).join('');
    },

    exportAvanceColegios: function() {
        const filas = this._buildAvanceData();
        if (!filas.length) { alert("No hay datos para exportar."); return; }

        const rows = [['Colegio','Regional','Coach','Clasificación','Talleres meta','Docentes BD','Meta asistencias','Asistencias reales','Avance %','Satisfacción','Talleres realizados']];
        filas.forEach(f => {
            rows.push([
                f.colegio, f.regional, f.coach, f.clasificacion,
                f.metaTalleres, f.docentes, f.metaAsistencias,
                f.asistenciasReales, f.avancePct.toFixed(1),
                f.satisfaccion !== null ? f.satisfaccion.toFixed(2) : '',
                f.talleresRealizados
            ]);
        });
        const csv  = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = 'avance_colegios.csv'; a.click();
        URL.revokeObjectURL(url);
    },

    showAvanceExplanation: function() { App.showModal('Sobre el Avance del Ciclo Anual', `<div class="space-y-4 text-sm"><p>El <strong>Avance del Ciclo Anual</strong> mide la profundidad de nuestro acompañamiento.</p><div class="bg-green-50 p-4 rounded-xl">Colegios AAA: 6 talleres | Colegios Ri: 4 talleres | Colegios AA: 3 talleres.</div></div>`, '<button type="button" onclick="App.hideModal()" class="px-6 py-2 bg-green-600 text-white rounded-xl">Entendido</button>'); },


    showDetractoresModal: function() {
        const detractores = Array.isArray(State.detractoresActuales) ? State.detractoresActuales : [];
        const isAdmin = State.currentUserRole === 'admin';
        let body = '';
        if (detractores.length === 0) {
            body = '<div class="text-center text-green-600 py-10 font-bold">¡Sin alertas críticas con los filtros actuales!</div>';
        } else {
            body = `<div class="space-y-3">` + detractores.map(d => {
                const scores = { q6: getQVal(d,'q6'), q7: getQVal(d,'q7'), q8: getQVal(d,'q8'), q9: getQVal(d,'q9') };
                const minScore = Math.min(...Object.values(scores).filter(s => !isNaN(s)));
                const f = formatFechaDisplay(d);
                const labels = { q6: 'Conocimiento', q7: 'Utilidad', q8: 'Dinamismo', q9: 'Recursos' };
                const scoresHtml = Object.keys(scores).map(q => {
                    const v = scores[q];
                    if (isNaN(v)) return '';
                    const color = v <= 2 ? 'bg-red-100 text-red-700' : v <= 3 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700';
                    return `<span class="px-2 py-0.5 rounded text-[10px] font-bold ${color}">${labels[q]}: ${v}</span>`;
                }).join(' ');
                const coachLine = isAdmin ? `<p class="text-xs font-bold text-gray-700 mt-1"><i class="fa-solid fa-user-tie mr-1 opacity-60"></i> Coach: ${escapeHtml(d.coach || 'Sin asignar')}</p>` : '';
                return `<div class="p-4 bg-red-50 rounded-xl border border-red-100">
                    <div class="flex flex-wrap justify-between items-start gap-2 mb-2">
                        <div>
                            <p class="font-bold text-red-900 text-sm">${escapeHtml(d.colegio || 'Sin colegio')}</p>
                            <p class="text-[10px] text-red-700">${f} ${d.taller ? '· ' + escapeHtml(d.taller) : ''}</p>
                            ${coachLine}
                            <p class="text-xs text-gray-600 mt-1"><i class="fa-solid fa-chalkboard-user mr-1 opacity-60"></i> ${escapeHtml(d.asistente || 'Anónimo')} ${d.perfil ? '(' + escapeHtml(d.perfil) + ')' : ''}</p>
                        </div>
                        <span class="w-9 h-9 flex items-center justify-center bg-red-600 text-white rounded-lg text-base font-black shadow-sm shrink-0">${minScore}</span>
                    </div>
                    <div class="flex flex-wrap gap-1.5 mb-2">${scoresHtml}</div>
                    <div class="bg-white/70 p-2.5 rounded-lg border border-red-100/50 text-xs italic text-gray-800 shadow-inner">"${escapeHtml(d.sugerencias || 'Sin comentarios registrados.')}"</div>
                </div>`;
            }).join('') + `</div>`;
        }
        App.showModal(`Detractores (${detractores.length}) — calificación ≤ 2 en alguna pregunta`, body, '<button type="button" onclick="App.hideModal()" class="px-6 py-2 bg-[#FF5A00] text-white rounded-xl">Cerrar</button>');
    },

    
    mostrarEstadoCobertura: function() {
        const coachF = State.currentUserRole === 'admin' ? (document.getElementById('filter_coach')?.value || "") : (State.loginUser?.nombre || "");
        const regF = document.getElementById('filter_regional')?.value || ""; 
        const calF = document.getElementById('filter_calendario')?.value || ""; 
        const clasF = document.getElementById('filter_clasificacion')?.value || "";
        const lineaNodes = document.querySelectorAll('.linea-cb:checked'); 
        const lineasF = lineaNodes ? Array.from(lineaNodes).map(cb => cb.value) : [];

        let colegiosAsignados = (State.colegiosBD || []).filter(c => c.colegio !== "[NUEVO COACH SIN COLEGIO]");
        if(regF) colegiosAsignados = colegiosAsignados.filter(c => c.regional === regF);
        if(coachF) colegiosAsignados = colegiosAsignados.filter(c => c.coach === coachF);
        if(calF) colegiosAsignados = colegiosAsignados.filter(c => c.calendario && c.calendario.trim().toUpperCase() === calF);
        if(clasF) colegiosAsignados = colegiosAsignados.filter(c => c.clasificacion === clasF);
        if(lineasF.length > 0) colegiosAsignados = colegiosAsignados.filter(c => c.lineaNegocio && lineasF.includes(c.lineaNegocio.trim()));

        const encuestasActuales = State.filteredEncuestas || [];
        const colegiosConEncuestas = new Set(encuestasActuales.map(e => (e.colegio || "").toUpperCase()));

        const grouped = {};
        colegiosAsignados.forEach(c => {
            const reg = c.regional || 'Sin Regional';
            if (!grouped[reg]) grouped[reg] = [];
            const atendido = colegiosConEncuestas.has((c.colegio || "").toUpperCase());
            grouped[reg].push({ nombre: c.colegio, coach: c.coach, atendido: atendido });
        });

        let bodyHtml = `<div class="space-y-6 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">`;
        
        if (Object.keys(grouped).length === 0) {
            bodyHtml += `<p class="text-sm text-gray-500 italic text-center py-8">No hay colegios asignados bajo estos filtros.</p>`;
        } else {
            for (const [reg, colegios] of Object.entries(grouped)) {
                const atendidosCount = colegios.filter(c => c.atendido).length;
                const totalCount = colegios.length;
                const pct = Math.round((atendidosCount / totalCount) * 100) || 0;
                
                bodyHtml += `
                <div class="bg-gray-50 rounded-xl p-4 border border-gray-100">
                    <div class="flex justify-between items-center mb-3 border-b border-gray-200 pb-2">
                        <h4 class="font-black text-[#FF5A00] uppercase text-xs tracking-widest"><i class="fa-solid fa-map-location-dot mr-1"></i> ${reg}</h4>
                        <span class="text-xs font-bold ${pct === 100 ? 'text-green-600 bg-green-100' : 'text-gray-500 bg-white'} px-2 py-1 rounded shadow-sm">${atendidosCount} de ${totalCount} (${pct}%)</span>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">`;
                
                colegios.sort((a,b) => {
                    if(a.atendido === b.atendido) return a.nombre.localeCompare(b.nombre);
                    return a.atendido ? 1 : -1; 
                });

                colegios.forEach(c => {
                    const icon = c.atendido ? `<i class="fa-solid fa-circle-check text-green-500"></i>` : `<i class="fa-regular fa-circle text-gray-300"></i>`;
                    const textStyle = c.atendido ? `text-gray-700` : `text-gray-400 italic`;
                    const bgStyle = c.atendido ? `bg-white border-green-200 shadow-sm` : `bg-white/50 border-gray-100 opacity-80`;
                    
                    bodyHtml += `
                    <div class="flex flex-col p-2.5 rounded-lg border ${bgStyle}">
                        <div class="flex items-center gap-2">
                            ${icon}
                            <span class="text-xs font-bold ${textStyle} truncate" title="${c.nombre}">${c.nombre}</span>
                        </div>
                        ${State.currentUserRole === 'admin' && !coachF ? `<span class="text-[9px] text-gray-500 ml-6 mt-0.5"><i class="fa-solid fa-user-tie opacity-50 mr-1"></i>${c.coach}</span>` : ''}
                    </div>`;
                });
                bodyHtml += `</div></div>`;
            }
        }
        bodyHtml += `</div>`;

        App.showModal(`Estado de Cobertura`, bodyHtml, `<button type="button" onclick="App.hideModal()" class="px-6 py-2 bg-[#002C5F] text-white rounded-xl font-bold transition-colors hover:bg-blue-900">Cerrar Panel</button>`);
    },

    submitForm: async function(e) {
        e.preventDefault();
        const inputColegio = document.getElementById('q1_colegio').value;
        const safeColegios = Array.isArray(State.colegiosBD) ? State.colegiosBD : [];
        if (!safeColegios.some(c => c.colegio === inputColegio)) { alert("⚠️ Por favor, selecciona un colegio válido de la lista desplegable."); return; }
        const btn = document.getElementById('btnSubmitForm'); btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Guardando...';
        const formData = { fecha: new Date().toLocaleDateString('es-CO'), timestamp: Date.now(), ciclo: document.getElementById('ciclo').value, colegio: inputColegio, asistente: document.getElementById('q2_asistente').value, perfil: document.querySelector('input[name="q3_perfil"]:checked').value, coach: document.getElementById('q4_coach').value, numTaller: document.getElementById('q5_numTaller').value, taller: document.getElementById('q5_taller').value, q6: parseInt(document.querySelector('input[name="q6"]:checked').value), q7: parseInt(document.querySelector('input[name="q7"]:checked').value), q8: parseInt(document.querySelector('input[name="q8"]:checked').value), q9: parseInt(document.querySelector('input[name="q9"]:checked').value), sugerencias: document.getElementById('q10_sugerencias').value };
        try {
            const docRef = await addDoc(collection(db, "encuestas"), formData); 
            if(Array.isArray(State.encuestasData)) State.encuestasData.push({ id: docRef.id, ...formData });
            document.getElementById('encuestaForm').reset(); document.getElementById('successMsg').classList.remove('hidden'); window.scrollTo({ top: 0, behavior: 'smooth' });
            try { const resumenRef = doc(db, "metricas", "resumen_global"); await updateDoc(resumenRef, { total_encuestas: increment(1) }); } catch (e) { if (e.code === 'not-found') await setDoc(doc(db, "metricas", "resumen_global"), { total_encuestas: 1 }); }
            if (State.currentUserRole) App.handleFilterTrigger(); 
        } catch (error) { alert("Hubo un error guardando la encuesta. Intenta de nuevo."); } finally { btn.disabled = false; btn.innerHTML = '<span>Enviar Feedback</span>'; }
    },

    handleColegioInput: function() {
        const val = document.getElementById('q1_colegio').value.toLowerCase(); const list = document.getElementById('listaColegiosCustom'); list.innerHTML = '';
        if(!val) { list.classList.add('hidden'); return; }
        const safeColegios = Array.isArray(State.colegiosBD) ? State.colegiosBD : [];
        const matches = safeColegios.filter(c => (c.colegio || '').toLowerCase().includes(val)).slice(0, 10);
        if(matches.length > 0) { matches.forEach(m => { const li = document.createElement('li'); li.className = 'px-4 py-3 hover:bg-orange-50 cursor-pointer text-sm border-b flex justify-between'; li.innerHTML = `<span>${m.colegio}</span> <span class="text-[10px] text-gray-400 font-bold">${m.regional}</span>`; li.onclick = () => { document.getElementById('q1_colegio').value = m.colegio; document.getElementById('q4_coach').value = m.coach; list.classList.add('hidden'); }; list.appendChild(li); }); list.classList.remove('hidden'); } else list.classList.add('hidden');
    },

    poblarCoaches: function() { const sel = document.getElementById('q4_coach'); if(sel) { sel.innerHTML = '<option value="">Seleccione coach...</option>'; const safeColegios = Array.isArray(State.colegiosBD) ? State.colegiosBD : []; [...new Set(safeColegios.map(c => c.coach).filter(Boolean))].sort().forEach(c => sel.innerHTML += `<option value="${c}">${c}</option>`); } },
    openImportModal: function() { this.showModal("Importar", `<div class="flex gap-4 pt-2"><button type="button" onclick="App.downloadEncuestaTemplate()" class="flex-1 py-3 bg-gray-100 rounded-xl">Plantilla</button><button type="button" onclick="document.getElementById('fileImportEncuestas').click()" class="flex-1 py-3 bg-[#002C5F] text-white rounded-xl">Subir Excel</button></div>`, `<button type="button" onclick="App.hideModal()" class="px-6 py-2 bg-gray-200 rounded-xl">Cerrar</button>`); },
    downloadEncuestaTemplate: function() { const ws = XLSX.utils.json_to_sheet([{ id: "DEJAR_VACIO_NUEVO_REGISTRO", fecha: new Date().toLocaleDateString('es-CO'), ciclo: "Ciclo Inclusión", colegio: "COLEGIO DE EJEMPLO", asistente: "Juan", perfil: "Docente", coach: "Coach X", numTaller: "Taller 1", taller: "Tema Y", q6: 5, q7: 4, q8: 5, q9: 5, sugerencias: "Buen taller." }]); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Encuestas"); XLSX.writeFile(wb, "Plantilla_Encuestas.xlsx"); },
    clearData: async function() { if(!confirm("⚠️ PELIGRO: ¿Borrar todas las encuestas en la nube?")) return; try { const btn = document.getElementById('btn_clear_data'); btn.innerText = "Borrando..."; btn.disabled = true; const safeEncuestas = Array.isArray(State.encuestasData) ? State.encuestasData : []; for(const enc of safeEncuestas) await deleteDoc(doc(db, "encuestas", enc.id)); State.encuestasData = []; State.filteredEncuestas = []; this.updateDashboard(); alert("Borradas."); } catch(e) { alert("Error"); } finally { document.getElementById('btn_clear_data').innerHTML = 'Borrar Todo'; document.getElementById('btn_clear_data').disabled = false; } },
    showModal: function(title, body, footer) { document.getElementById('modalHeader').innerText = title; document.getElementById('modalBody').innerHTML = body; document.getElementById('modalFooter').innerHTML = footer; document.getElementById('customModal').classList.remove('hidden'); },
    hideModal: function() { document.getElementById('customModal').classList.add('hidden'); },
    switchDashSubTab: function(id) {
        ['subTabResultados', 'subTabRegistros', 'subTabEdicion', 'subTabAvance'].forEach(t => {
            const el = document.getElementById(t);
            if (el) el.classList.add('hidden');
        });
        const capId = id.charAt(0).toUpperCase() + id.slice(1);
        const target = document.getElementById('subTab' + capId);
        if (target) target.classList.remove('hidden');

        ['btn-sub-resultados', 'btn-sub-registros', 'btn-sub-edicion', 'btn-sub-avance'].forEach(b => {
            const btn = document.getElementById(b);
            if (btn) btn.className = "py-2 px-6 rounded-lg text-sm font-bold transition-all text-gray-500 hover:bg-gray-50";
        });
        const activeBtn = document.getElementById('btn-sub-' + id);
        if (activeBtn) activeBtn.className = "py-2 px-6 rounded-lg text-sm font-bold transition-all bg-[#FF5A00] text-white";

        const edContainer = document.getElementById('edicionTableContainer');
        if (id === 'edicion' && edContainer) edContainer.classList.add('hidden');
        if (id === 'avance') this.renderAvanceColegios();
    },
    
    handleEdicionFilterTrigger: function() { this.refreshEdicionFilters(); this.renderActiveEdicionTable(); },
    refreshEdicionFilters: function() {
        const safeColegios = Array.isArray(State.colegiosBD) ? State.colegiosBD : [];
        let base = safeColegios.filter(c => c.colegio !== "[NUEVO COACH SIN COLEGIO]");
        const regEl = document.getElementById('edicion_filter_regional'); const coachEl = document.getElementById('edicion_filter_coach');
        const updateDropdown = (el, validOptions, defaultText, currentVal) => { if(!el) return; el.innerHTML = `<option value="">${defaultText}</option>`; validOptions.forEach(v => el.innerHTML += `<option value="${v}">${v}</option>`); if (validOptions.includes(currentVal)) el.value = currentVal; else el.value = ''; };
        updateDropdown(regEl, [...new Set(base.map(c => c.regional).filter(Boolean))].sort(), 'Todas las Regionales', regEl?.value);
        updateDropdown(coachEl, [...new Set(base.map(c => c.coach).filter(Boolean))].sort(), 'Todos los Coaches', coachEl?.value);
    },
    openEditView: function(view) {
        State.currentEdicionView = view;
        const edContainer = document.getElementById('edicionTableContainer'); const sEdicion = document.getElementById('search_edicion');
        if(edContainer) edContainer.classList.remove('hidden'); if(sEdicion) sEdicion.value = ''; 
        const titleEl = document.getElementById('edicionTableTitle'); const filtersEl = document.getElementById('edicion_filters');
        if(view === 'colegios') { if(titleEl) titleEl.innerHTML = '<i class="fa-solid fa-school mr-2"></i> Colegios'; if(filtersEl) filtersEl.classList.remove('hidden'); this.handleEdicionFilterTrigger(); } 
        else { if(titleEl) titleEl.innerHTML = '<i class="fa-solid fa-user-tie mr-2"></i> Coaches'; if(filtersEl) filtersEl.classList.add('hidden'); this.renderActiveEdicionTable(); }
        if(edContainer) edContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    renderActiveEdicionTable: function() {
        const head = document.getElementById('edicion_head'); const body = document.getElementById('edicion_body');
        if(!head || !body) return;
        const searchVal = document.getElementById('search_edicion')?.value.toLowerCase().trim() || "";
        
        if(State.currentEdicionView === 'colegios') {
            const regVal = document.getElementById('edicion_filter_regional')?.value || ""; const coachVal = document.getElementById('edicion_filter_coach')?.value || "";
            head.innerHTML = `<tr><th class="px-6 py-4">Colegio</th><th class="px-6 py-4">Regional</th><th class="px-6 py-4">Coach</th><th class="px-6 py-4 text-center">Acciones</th></tr>`; body.innerHTML = '';
            const safeColegios = Array.isArray(State.colegiosBD) ? State.colegiosBD : [];
            safeColegios.forEach((c, idx) => { if ((searchVal === '' || (c.colegio||'').toLowerCase().includes(searchVal)) && (regVal === '' || c.regional === regVal) && (coachVal === '' || c.coach === coachVal)) { body.innerHTML += `<tr class="hover:bg-gray-50 border-b"><td class="px-6 py-4 font-bold">${c.colegio}</td><td class="px-6 py-4">${c.regional}</td><td class="px-6 py-4">${c.coach}</td><td class="px-6 py-4 text-center"><button type="button" onclick="App.openEditColegioModal(${idx})" class="text-blue-500 mx-1"><i class="fa-solid fa-pen"></i></button><button type="button" onclick="App.deleteColegio(${idx})" class="text-red-500 mx-1"><i class="fa-solid fa-trash"></i></button></td></tr>`; } });
        } else {
            head.innerHTML = `<tr><th class="px-6 py-4">Coach</th><th class="px-6 py-4">Email</th><th class="px-6 py-4">Regional base</th><th class="px-6 py-4 text-center">Acciones</th></tr>`; body.innerHTML = '';
            const safeCoaches = Array.isArray(State.coachesAuth) ? State.coachesAuth : [];
            safeCoaches.forEach((c, idx) => { if (searchVal === '' || (c.nombre||'').toLowerCase().includes(searchVal) || (c.email||'').toLowerCase().includes(searchVal)) { body.innerHTML += `<tr class="hover:bg-gray-50 border-b"><td class="px-6 py-4 font-bold">${c.nombre}</td><td class="px-6 py-4">${c.email}</td><td class="px-6 py-4">${c.regional}</td><td class="px-6 py-4 text-center"><button type="button" onclick="App.openEditCoachModal(${idx})" class="text-blue-500 mx-1"><i class="fa-solid fa-pen"></i></button><button type="button" onclick="App.deleteCoach(${idx})" class="text-red-500 mx-1"><i class="fa-solid fa-trash"></i></button></td></tr>`; } });
        }
    },
    deleteColegio: async function(idx) { if(!confirm("¿Borrar colegio?")) return; try { await deleteDoc(doc(db, "colegios", State.colegiosBD[idx].id)); State.colegiosBD.splice(idx, 1); await invalidateRemoteCache(); this.renderActiveEdicionTable(); } catch(e) { alert("Error"); } },
    deleteCoach: async function(idx) { if(!confirm("¿Borrar coach?")) return; try { await deleteDoc(doc(db, "coaches", State.coachesAuth[idx].id)); State.coachesAuth.splice(idx, 1); await invalidateRemoteCache(); this.renderActiveEdicionTable(); } catch(e) { alert("Error"); } },
    openEditColegioModal: function(idx) {
        const isEdit = idx >= 0; const data = isEdit ? State.colegiosBD[idx] : { colegio: '', regional: '', coach: '', docentes: 0, calendario: 'A', lineaNegocio: 'Compartir', clasificacion: 'AA' };
        const safeColegios = Array.isArray(State.colegiosBD) ? State.colegiosBD : [];
        // La regional la define el colegio; se listan las regionales ya existentes entre colegios (incluye p.ej. "Bogotá Norte" y "Bogotá Sur" si ya existen).
        let regOptions = '<option value="">Seleccione Regional...</option>'; [...new Set(safeColegios.map(c => c.regional).filter(Boolean))].sort().forEach(r => regOptions += `<option value="${r}" ${data.regional === r ? 'selected' : ''}>${r}</option>`);
        this.showModal(isEdit ? "Editar Institución" : "Nuevo Colegio", `<div class="space-y-4"><div><label class="text-xs font-bold">Nombre</label><input type="text" id="edit_col_nombre" value="${data.colegio}" class="w-full border rounded-xl px-4 py-2"></div><div class="grid grid-cols-2 gap-4"><div><label class="text-xs font-bold">Regional</label><select id="edit_col_reg" class="w-full border rounded-xl px-4 py-2">${regOptions}</select><input type="text" id="edit_col_reg_nueva" placeholder="O escriba una regional nueva..." class="w-full border rounded-xl px-4 py-2 mt-2 text-xs"></div><div><label class="text-xs font-bold">Coach</label><select id="edit_col_coach" class="w-full border rounded-xl px-4 py-2"><option value="${data.coach || ''}">${data.coach || 'Seleccione...'}</option></select></div></div><div class="grid grid-cols-2 gap-4 border-t pt-4"><div><label class="text-[10px] font-bold">Docentes</label><input type="number" id="edit_col_docentes" value="${data.docentes || 0}" class="w-full border rounded-xl px-4 py-2"></div><div><label class="text-[10px] font-bold">Clasificación</label><input type="text" id="edit_col_clasif" value="${data.clasificacion || ''}" class="w-full border rounded-xl px-4 py-2"></div></div></div>`, `<button type="button" onclick="App.hideModal()" class="px-6 py-2 bg-gray-200 rounded-xl">Cancelar</button><button type="button" onclick="App.saveEditColegio(${idx})" class="px-6 py-2 bg-[#FF5A00] text-white rounded-xl">Guardar</button>`);
        this.updateCoachOptionsEdit(data.coach);
    },
    openEditCoachModal: function(idx) {
        const data = State.coachesAuth[idx];
        this.showModal("Editar Coach", `<div class="space-y-4"><div><label class="text-xs font-bold">Nombre</label><input type="text" id="edit_coach_nombre" value="${data.nombre}" class="w-full border rounded-xl px-4 py-2"></div><div><label class="text-xs font-bold">Email</label><input type="email" id="edit_coach_email" value="${data.email}" class="w-full border rounded-xl px-4 py-2"></div><div class="grid grid-cols-2 gap-4"><div><label class="text-xs font-bold">Regional base</label><input type="text" id="edit_coach_regional" value="${data.regional}" class="w-full border rounded-xl px-4 py-2"><p class="text-[10px] text-gray-400 mt-1">Solo informativo. La zona real la define cada colegio asignado al coach, que puede pertenecer a varias regionales.</p></div><div><label class="text-xs font-bold">Contraseña</label><input type="text" id="edit_coach_pass" value="${data.pass || ''}" class="w-full border rounded-xl px-4 py-2"></div></div></div>`, `<button type="button" onclick="App.hideModal()" class="px-6 py-2 bg-gray-200 rounded-xl">Cancelar</button><button type="button" onclick="App.saveEditCoach(${idx})" class="px-6 py-2 bg-[#002C5F] text-white rounded-xl">Guardar</button>`);
    },
    updateCoachOptionsEdit: function(selectedCoach = '') {
        const selCoach = document.getElementById('edit_col_coach'); if(!selCoach) return;
        // La regional la define el COLEGIO, no el coach: un coach puede tener colegios en varias regionales.
        // Por eso aquí se listan TODOS los coaches, sin filtrar por su regional "base".
        selCoach.innerHTML = '<option value="">Seleccione Coach...</option>';
        const safeCoaches = Array.isArray(State.coachesAuth) ? State.coachesAuth : [];
        [...safeCoaches].sort((a,b) => (a.nombre||'').localeCompare(b.nombre||'')).forEach(c => selCoach.innerHTML += `<option value="${c.nombre}" ${c.nombre === selectedCoach ? 'selected' : ''}>${c.nombre}</option>`);
    },
    saveEditColegio: async function(idx) {
        const regionalNueva = document.getElementById('edit_col_reg_nueva').value.trim();
        const regional = regionalNueva || document.getElementById('edit_col_reg').value;
        const colData = { colegio: document.getElementById('edit_col_nombre').value.trim().toUpperCase(), regional: regional, coach: document.getElementById('edit_col_coach').value, docentes: parseInt(document.getElementById('edit_col_docentes').value) || 0, clasificacion: document.getElementById('edit_col_clasif').value.trim() };
        if(!colData.colegio || !colData.regional || !colData.coach) { alert("Completa Nombre, Regional y Coach."); return; }
        try { if(idx === -1) { const docRef = await addDoc(collection(db, "colegios"), colData); State.colegiosBD.unshift({ id: docRef.id, ...colData }); } else { const colId = State.colegiosBD[idx].id; await setDoc(doc(db, "colegios", colId), colData); State.colegiosBD[idx] = { id: colId, ...colData }; } await invalidateRemoteCache(); this.hideModal(); this.renderActiveEdicionTable(); this.handleFilterTrigger(); } catch (e) { alert("Error al guardar."); }
    },
    saveEditCoach: async function(idx) {
        const coachData = { nombre: document.getElementById('edit_coach_nombre').value.trim(), email: document.getElementById('edit_coach_email').value.trim().toLowerCase(), regional: document.getElementById('edit_coach_regional').value.trim(), pass: document.getElementById('edit_coach_pass').value.trim() };
        if(!coachData.nombre || !coachData.email || !coachData.regional) { alert("Faltan datos."); return; }
        try { const coachId = State.coachesAuth[idx].id; await setDoc(doc(db, "coaches", coachId), coachData); State.coachesAuth[idx] = { id: coachId, ...coachData }; await invalidateRemoteCache(); this.hideModal(); this.renderActiveEdicionTable(); this.poblarCoaches(); } catch (e) { alert("Error al guardar."); }
    },
    exportData: function(type) {
        let data = type === 'colegios' ? State.colegiosBD : State.coachesAuth; let sheetName = type === 'colegios' ? "Colegios_BD" : "Coaches_Auth";
        const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheetName); XLSX.writeFile(wb, `BaseDatos_${type}.xlsx`);
    }
};

function initRatings() { ['q6', 'q7', 'q8', 'q9'].forEach(q => { const container = document.getElementById(`${q}_group`); if(container){ for(let i=1; i<=5; i++) container.innerHTML += `<label class="rating-label"><input type="radio" name="${q}" value="${i}" required><span class="text-xs mt-1">${i}</span></label>`; } }); }

document.getElementById('fileImportColegios')?.addEventListener('change', (e) => {
    const file = e.target.files[0]; if(!file) return; const reader = new FileReader();
    reader.onload = async (evt) => {
        App.showModal("Sincronizando...", "<div class='text-center py-4'><span class='loader'></span><p class='mt-4'>Procesando...</p></div>", "");
        try {
            const wb = XLSX.read(evt.target.result, {type: 'binary'}); let data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
            for (const col of data) {
                const cleanCol = { ...col }; delete cleanCol.id; 
                const safeColegios = Array.isArray(State.colegiosBD) ? State.colegiosBD : [];
                const existingIdx = safeColegios.findIndex(c => (c.colegio || '').toLowerCase() === (cleanCol.colegio || '').toLowerCase());
                if (existingIdx >= 0) { const docId = State.colegiosBD[existingIdx].id; await setDoc(doc(db, "colegios", docId), cleanCol); State.colegiosBD[existingIdx] = { id: docId, ...cleanCol }; } 
                else { const docRef = await addDoc(collection(db, "colegios"), cleanCol); State.colegiosBD.push({ id: docRef.id, ...cleanCol }); }
            }
            await invalidateRemoteCache();
            App.hideModal(); if(State.currentEdicionView === 'colegios') App.renderActiveEdicionTable(); alert("Base actualizada.");
        } catch(err) { App.hideModal(); alert("Error"); }
    }; reader.readAsBinaryString(file); e.target.value = null;
});

document.getElementById('fileImportCoaches')?.addEventListener('change', (e) => {
    const file = e.target.files[0]; if(!file) return; const reader = new FileReader();
    reader.onload = async (evt) => {
        App.showModal("Sincronizando...", "<div class='text-center py-4'><span class='loader'></span><p class='mt-4'>Procesando...</p></div>", "");
        try {
            const wb = XLSX.read(evt.target.result, {type: 'binary'}); const importedCoaches = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
            for (const newCoach of importedCoaches) {
                const safeCoaches = Array.isArray(State.coachesAuth) ? State.coachesAuth : [];
                const coachExistenteIdx = safeCoaches.findIndex(c => (c.email || '').toLowerCase() === (newCoach.email || '').trim().toLowerCase());
                if (coachExistenteIdx >= 0) { const docId = State.coachesAuth[coachExistenteIdx].id; const passActual = State.coachesAuth[coachExistenteIdx].pass; const updatedData = { ...newCoach, pass: passActual }; delete updatedData.id; await setDoc(doc(db, "coaches", docId), updatedData); State.coachesAuth[coachExistenteIdx] = { id: docId, ...updatedData }; } 
                else { const cleanCoach = {...newCoach}; if(!cleanCoach.pass) cleanCoach.pass = '12345'; delete cleanCoach.id; const docRef = await addDoc(collection(db, "coaches"), cleanCoach); State.coachesAuth.push({ id: docRef.id, ...cleanCoach }); }
            }
            await invalidateRemoteCache();
            App.hideModal(); if(State.currentEdicionView === 'coaches') App.renderActiveEdicionTable(); alert("Coaches actualizados.");
        } catch(err) { App.hideModal(); alert("Error"); }
    }; reader.readAsBinaryString(file); e.target.value = null;
});

document.getElementById('fileImportEncuestas')?.addEventListener('change', (e) => {
    const file = e.target.files[0]; if(!file) return; const reader = new FileReader();
    reader.onload = async (evt) => {
        App.showModal("Sincronizando...", "<div class='text-center py-4'><span class='loader'></span></div>", "");
        try {
            const wb = XLSX.read(evt.target.result, {type: 'binary'}); const importedData = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
            for(const row of importedData) {
                if (!row.colegio || !row.coach) continue; 
                const safeEncuestas = Array.isArray(State.encuestasData) ? State.encuestasData : [];
                if (row.id && row.id !== "DEJAR_VACIO_NUEVO_REGISTRO") {
                    const existingIdx = safeEncuestas.findIndex(d => d.id === row.id.toString());
                    if (existingIdx >= 0) { await setDoc(doc(db, "encuestas", row.id.toString()), row); State.encuestasData[existingIdx] = { ...State.encuestasData[existingIdx], ...row, id: row.id.toString() }; } 
                    else { await setDoc(doc(db, "encuestas", row.id.toString()), row); State.encuestasData.push({ ...row, id: row.id.toString() }); }
                } else {
                    const cleanRow = {...row}; if (!cleanRow.timestamp) cleanRow.timestamp = Date.now(); delete cleanRow.id;
                    const docRef = await addDoc(collection(db, "encuestas"), cleanRow); State.encuestasData.push({ id: docRef.id, ...cleanRow });
                }
            }
            App.hideModal(); App.handleFilterTrigger(); alert(`Sincronización completada.`);
        } catch(error) { App.hideModal(); alert("Error procesando excel."); }
    }; reader.readAsBinaryString(file); e.target.value = null; 
});

window.onload = async () => {
    initRatings();
    await initApp(); 

    window.addEventListener('click', function(e) {
        const dropColegios = document.getElementById('listaColegiosCustom'); const inputColegio = document.getElementById('q1_colegio');
        if (dropColegios && inputColegio && !dropColegios.contains(e.target) && e.target !== inputColegio) dropColegios.classList.add('hidden');
        
        const dropLineas = document.getElementById('dropdown_lineas'); const btnLineas = document.getElementById('btn_dropdown_lineas');
        if (dropLineas && btnLineas && !dropLineas.contains(e.target) && !btnLineas.contains(e.target)) {
            dropLineas.classList.add('hidden'); dropLineas.setAttribute('aria-hidden', 'true'); if(btnLineas) btnLineas.setAttribute('aria-expanded', 'false');
        }
        
        const dropMeses = document.getElementById('dropdown_meses'); const btnMeses = document.getElementById('btn_dropdown_meses');
        if (dropMeses && btnMeses && !dropMeses.contains(e.target) && !btnMeses.contains(e.target)) {
            dropMeses.classList.add('hidden'); dropMeses.setAttribute('aria-hidden', 'true'); if(btnMeses) btnMeses.setAttribute('aria-expanded', 'false');
        }
    });
};
