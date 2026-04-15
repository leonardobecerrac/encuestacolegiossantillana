// app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, where, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, updatePassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyDrVXpZfLwn0iddsaQWyXzRCvZ0bXkwviA",
    authDomain: "encuesta-santillana.firebaseapp.com",
    projectId: "encuesta-santillana",
    storageBucket: "encuesta-santillana.firebasestorage.app",
    messagingSenderId: "354271667135",
    appId: "1:354271667135:web:9edb98cb6c5f868a7e370a"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Reglas de negocio centralizadas
const BusinessRules = { metasCiclo: { 'AAA': 6, 'RI': 4, 'AA': 3 } };

const State = {
    colegiosBD: [], coachesAuth: [], encuestasData: [], filteredEncuestas: [], registrosFiltrados: [],
    encuestasLoaded: false, currentUserRole: null, loginUser: null, currentView: 'formTab', currentEdicionView: 'colegios'
};

window.trendChartInst = null;

// Optimización: Uso de Caché Local
async function initApp() {
    try {
        const cachedCol = localStorage.getItem('santillana_colegios');
        const cachedCoach = localStorage.getItem('santillana_coaches');
        const cacheTime = localStorage.getItem('santillana_cache_time');
        
        const isCacheValid = cacheTime && (Date.now() - parseInt(cacheTime) < 86400000);

        if (cachedCol && cachedCoach && isCacheValid) {
            State.colegiosBD = JSON.parse(cachedCol);
            State.coachesAuth = JSON.parse(cachedCoach);
            console.log("✅ Datos cargados desde la memoria local");
            return; 
        }

        console.log("☁️ Descargando de Firebase...");
        const colSnap = await getDocs(collection(db, "colegios"));
        State.colegiosBD = [];
        colSnap.forEach(d => State.colegiosBD.push({ id: d.id, ...d.data() }));

        const coachSnap = await getDocs(collection(db, "coaches"));
        State.coachesAuth = [];
        coachSnap.forEach(d => State.coachesAuth.push({ id: d.id, ...d.data() }));

        localStorage.setItem('santillana_colegios', JSON.stringify(State.colegiosBD));
        localStorage.setItem('santillana_coaches', JSON.stringify(State.coachesAuth));
        localStorage.setItem('santillana_cache_time', Date.now().toString());

    } catch (error) {
        console.error("Error Firebase:", error);
    }
}

// Optimización: Filtro por año
async function fetchEncuestas() {
    if (State.encuestasLoaded) return;
    try {
        const inicioDeAño = new Date(new Date().getFullYear(), 0, 1).getTime();
        let q;

        if (State.currentUserRole === 'admin') {
            q = query(collection(db, "encuestas"), where("timestamp", ">=", inicioDeAño));
        } else {
            q = query(collection(db, "encuestas"), 
                where("coach", "==", State.loginUser.nombre), 
                where("timestamp", ">=", inicioDeAño)
            );
        }
            
        const encuestasSnap = await getDocs(q);
        State.encuestasData = [];
        encuestasSnap.forEach((d) => State.encuestasData.push({ id: d.id, ...d.data() }));
        
        State.encuestasData.sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0));
        
        State.encuestasLoaded = true;
        console.log(`✅ ${State.encuestasData.length} encuestas descargadas.`);
    } catch (error) { 
        console.error("Error cargando encuestas", error); 
    }
}

window.App = {
    switchTab: function(tabId) {
        ['formTab', 'dashTab'].forEach(id => document.getElementById(id).classList.add('hidden'));
        document.getElementById(tabId).classList.remove('hidden');
        ['btn-formTab', 'btn-dashTab', 'btn-coachTab'].forEach(btn => { const el = document.getElementById(btn); if(el) el.classList.remove('tab-active'); });
        if(tabId === 'formTab') document.getElementById('btn-formTab').classList.add('tab-active');
        else if(State.currentUserRole === 'admin') document.getElementById('btn-dashTab').classList.add('tab-active');
        else document.getElementById('btn-coachTab').classList.add('tab-active');
        if(tabId === 'dashTab') App.updateDashboard();
    },

    attemptLogin: function(role) {
        if (State.currentUserRole === role) { this.switchTab('dashTab'); return; }
        const title = role === 'admin' ? "Coordinación Santillana" : "Acceso Coach Académico";
        this.showModal(title, `
            <div class="space-y-4">
                <p class="text-sm text-gray-500">Ingresa tus credenciales autorizadas:</p>
                <input type="email" id="loginEmail" class="w-full border rounded-xl px-4 py-3" placeholder="Correo corporativo">
                <input type="password" id="loginPwd" class="w-full border rounded-xl px-4 py-3" placeholder="Contraseña">
                <p id="loginError" class="text-red-500 text-xs hidden font-bold">Credenciales no válidas o rol incorrecto.</p>
            </div>
        `, `<button onclick="App.hideModal()" class="px-6 py-2 bg-gray-100 rounded-xl font-bold">Cancelar</button>
            <button onclick="App.verifyLogin('${role}')" class="px-6 py-2 bg-orange-600 text-white rounded-xl font-bold">Entrar</button>`);
    },

    verifyLogin: async function(role) {
        const email = document.getElementById('loginEmail').value.trim().toLowerCase();
        const pass = document.getElementById('loginPwd').value;
        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, pass);
            const loggedUser = userCredential.user;
            
            // CORRECCIÓN: Búsqueda defensiva para evitar errores si c.email es undefined
            const coachInfo = State.coachesAuth.find(c => c.email && c.email.toLowerCase() === email);
            
            if (role === 'coach' && !coachInfo) { await signOut(auth); throw new Error("No registrado como coach en la base de datos"); }
            if (role === 'admin' && coachInfo) { await signOut(auth); throw new Error("Es un coach, no puede entrar como admin"); }

            State.currentUserRole = role;
            State.loginUser = role === 'admin' ? { email: loggedUser.email, nombre: loggedUser.email.split('@')[0] } : coachInfo;
            State.encuestasLoaded = false; 
            this.hideModal();
            
            document.getElementById('user-controls').classList.remove('hidden');
            document.getElementById('user-controls').classList.add('flex');
            document.getElementById('nav-user-name').innerText = State.loginUser.nombre;
            document.getElementById('nav-user-role').innerText = role;
            
            const dynGrid = document.getElementById('dynamic_dashboard_grid');
            const bTrend = document.getElementById('block_trend');
            const bRankC = document.getElementById('block_rank_coach');
            const bAlertas = document.getElementById('block_alertas');
            const coreTable = document.getElementById('registros_core_container');
            
            if(role === 'admin') {
                document.getElementById('adminSubNav').classList.remove('hidden');
                document.getElementById('coachWelcomeBar').classList.add('hidden');
                document.getElementById('container_filter_coach').classList.remove('hidden');
                dynGrid.className = 'grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6';
                bTrend.classList.remove('hidden'); bRankC.classList.remove('hidden');
                bAlertas.className = 'bg-white rounded-2xl shadow-sm p-6 border-l-4 border-red-500 lg:col-span-3'; 
                document.getElementById('subTabRegistros_content').appendChild(coreTable);
                document.getElementById('coach_registros_box').classList.add('hidden');
                document.getElementById('container_reg_filter_regional').classList.remove('hidden');
                document.getElementById('container_reg_filter_coach').classList.remove('hidden');
            } else {
                document.getElementById('adminSubNav').classList.add('hidden');
                document.getElementById('coachWelcomeBar').classList.remove('hidden');
                document.getElementById('display_coach_name').innerText = State.loginUser.nombre;
                document.getElementById('container_filter_coach').classList.add('hidden');
                dynGrid.className = 'grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6';
                bTrend.classList.add('hidden'); bRankC.classList.add('hidden');
                bAlertas.className = 'bg-white rounded-2xl shadow-sm p-6 border-l-4 border-red-500 lg:col-span-1';
                document.getElementById('content_coach_registros').appendChild(coreTable);
                document.getElementById('coach_registros_box').classList.remove('hidden');
                document.getElementById('container_reg_filter_regional').classList.add('hidden');
                document.getElementById('container_reg_filter_coach').classList.add('hidden');
            }
            this.switchTab('dashTab');
            this.initFiltrosBasicos();
            await fetchEncuestas();
            this.handleFilterTrigger();
        } catch (error) { 
            // CORRECCIÓN: Log detallado para ver el error real de Firebase
            console.error("🕵️ Error detallado del login:", error);
            document.getElementById('loginError').classList.remove('hidden'); 
            // Opcional: Podrías inyectar el error en el HTML para verlo en pantalla
            // document.getElementById('loginError').innerText = "Error: " + error.message;
        }
    },

    logout: async function() {
        await signOut(auth);
        State.currentUserRole = null; State.loginUser = null; State.encuestasLoaded = false;
        State.encuestasData = []; State.filteredEncuestas = [];
        document.getElementById('user-controls').classList.add('hidden'); document.getElementById('user-controls').classList.remove('flex');
        if(window.trendChartInst) window.trendChartInst.destroy();
        this.switchTab('formTab');
    },

    toggleCoachRegistros: function() {
        const content = document.getElementById('content_coach_registros');
        const icon = document.getElementById('icon_coach_registros');
        if(content.classList.contains('hidden')) { content.classList.remove('hidden'); icon.classList.add('rotate-180'); } 
        else { content.classList.add('hidden'); icon.classList.remove('rotate-180'); }
    },

    openChangePasswordModal: function() {
        App.showModal("Cambiar Contraseña", `<div class="space-y-4"><input type="password" id="new_pass" class="w-full border rounded-xl px-4 py-3" placeholder="Nueva contraseña"><input type="password" id="new_pass_confirm" class="w-full border rounded-xl px-4 py-3" placeholder="Confirmar nueva contraseña"></div><p id="pass_error" class="text-red-500 text-sm mt-2 hidden font-bold">Las contraseñas no coinciden o están vacías.</p>`, `<button onclick="App.hideModal()" class="px-6 py-2 bg-gray-200 rounded-xl font-bold">Cancelar</button><button onclick="App.saveNewPassword()" class="px-6 py-2 bg-[#FF5A00] text-white rounded-xl font-bold">Guardar</button>`);
    },

    saveNewPassword: async function() {
        const p1 = document.getElementById('new_pass').value;
        const p2 = document.getElementById('new_pass_confirm').value;
        if(!p1 || p1 !== p2) { document.getElementById('pass_error').classList.remove('hidden'); return; }
        try {
            if (auth.currentUser) await updatePassword(auth.currentUser, p1);
            if (State.currentUserRole === 'coach') {
                const idx = State.coachesAuth.findIndex(c => c.email === State.loginUser.email);
                if(idx !== -1) { State.coachesAuth[idx].pass = p1; await setDoc(doc(db, "coaches", State.coachesAuth[idx].id), State.coachesAuth[idx]); }
            }
            App.showModal("Éxito", "<p>Tu contraseña ha sido actualizada.</p>", `<button onclick="App.hideModal()" class="px-6 py-2 bg-[#002C5F] text-white rounded-xl font-bold">Aceptar</button>`);
        } catch (e) { alert("Error actualizando la contraseña."); }
    },

    toggleDropdown: function(id) { const el = document.getElementById(id); if (el) el.classList.toggle('hidden'); },

    initFiltrosBasicos: function() {
        const lineas = [...new Set(State.colegiosBD.map(c => c.lineaNegocio ? c.lineaNegocio.trim() : '').filter(Boolean))].sort();
        const dropLineas = document.getElementById('dropdown_lineas');
        if (dropLineas) {
            dropLineas.innerHTML = '';
            lineas.forEach(l => {
                dropLineas.innerHTML += `<label class="linea-label-container flex items-center space-x-2 p-2 hover:bg-orange-50 rounded-lg cursor-pointer transition-colors"><input type="checkbox" value="${l}" class="linea-cb accent-[#FF5A00] w-4 h-4" onchange="App.handleFilterTrigger()"><span class="text-xs font-medium text-gray-700">${l}</span></label>`;
            });
        }
        this.handleFilterTrigger(); 
    },

    handleFilterTrigger: function() { this.refreshCascadingFilters(); this.updateDashboard(); },

    refreshCascadingFilters: function() {
        let base = State.colegiosBD.filter(c => c.colegio !== "[NUEVO COACH SIN COLEGIO]");
        const regEl = document.getElementById('filter_regional'); const coachEl = document.getElementById('filter_coach');
        const colEl = document.getElementById('filter_colegio'); const calEl = document.getElementById('filter_calendario');
        const clasEl = document.getElementById('filter_clasificacion'); const lineasCbs = document.querySelectorAll('.linea-cb');
        const regVal = regEl.value; const coachVal = State.currentUserRole === 'admin' ? coachEl.value : State.loginUser.nombre;
        const colVal = colEl.value; const calVal = calEl.value; const clasVal = clasEl.value;
        const lineasVal = Array.from(lineasCbs).filter(cb => cb.checked).map(cb => cb.value);

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
            el.innerHTML = `<option value="">${text}</option>`;
            validData.forEach(v => el.innerHTML += `<option value="${v}">${v}</option>`);
            if (validData.includes(currentVal)) el.value = currentVal;
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
        if (numChecked === 0) textSpan.textContent = "Todas";
        else if (numChecked === 1) textSpan.textContent = document.querySelector('.linea-cb:checked').value;
        else textSpan.textContent = `${numChecked} seleccionadas`;

        const tSel = document.getElementById('filter_taller');
        if (colEl.value !== "") { tSel.disabled = false; tSel.classList.remove('cursor-not-allowed'); document.getElementById('container_filter_taller').classList.remove('opacity-50'); tSel.options[0].text = "Todos los Talleres"; } 
        else { tSel.value = ""; tSel.disabled = true; tSel.classList.add('cursor-not-allowed'); document.getElementById('container_filter_taller').classList.add('opacity-50'); tSel.options[0].text = "Primero elija colegio"; }
    },

    updateDashboard: function() {
        let data = State.encuestasData.map(d => { const colInfo = State.colegiosBD.find(c => c.colegio === d.colegio); return { ...d, regional: colInfo ? colInfo.regional : 'Sin Regional' }; });

        const regF = document.getElementById('filter_regional').value; const coachF = State.currentUserRole === 'admin' ? document.getElementById('filter_coach').value : State.loginUser.nombre;
        const colF = document.getElementById('filter_colegio').value; const tallerF = document.getElementById('filter_taller').value;
        const calF = document.getElementById('filter_calendario').value; const clasF = document.getElementById('filter_clasificacion').value;
        const lineasF = Array.from(document.querySelectorAll('.linea-cb:checked')).map(cb => cb.value);

        let masterFilter = State.colegiosBD.filter(c => c.colegio !== "[NUEVO COACH SIN COLEGIO]");
        if(regF) masterFilter = masterFilter.filter(c => c.regional === regF);
        if(coachF) masterFilter = masterFilter.filter(c => c.coach === coachF);
        if(colF) masterFilter = masterFilter.filter(c => c.colegio === colF);
        if(calF) masterFilter = masterFilter.filter(c => c.calendario && c.calendario.trim().toUpperCase() === calF);
        if(clasF) masterFilter = masterFilter.filter(c => c.clasificacion === clasF);
        if(lineasF.length > 0) masterFilter = masterFilter.filter(c => c.lineaNegocio && lineasF.includes(c.lineaNegocio.trim()));
        
        const colegiosPermitidos = new Set(masterFilter.map(c => c.colegio));
        if(regF) data = data.filter(d => d.regional === regF); if(coachF) data = data.filter(d => d.coach === coachF); if(tallerF) data = data.filter(d => d.numTaller === tallerF);
        data = data.filter(d => colegiosPermitidos.has(d.colegio));

        const fInicio = document.getElementById('filter_fecha_inicio').value; const fFin = document.getElementById('filter_fecha_fin').value;
        data = data.filter(d => {
            const t = d.timestamp || new Date(d.fecha.split(',')[0]).getTime() || Date.now();
            if (fInicio && t < new Date(fInicio + 'T00:00:00').getTime()) return false;
            if (fFin && t > new Date(fFin + 'T23:59:59').getTime()) return false;
            return true;
        });
        State.filteredEncuestas = data; 

        const metaAlcance = masterFilter.reduce((s, c) => s + (parseInt(c.docentes) || 0), 0);
        const colegiosCiclo = masterFilter.filter(c => { const clasif = c.clasificacion ? c.clasificacion.toUpperCase().trim() : ''; return !clasif.includes('PRODUCTO'); });
        const nombresColegiosCiclo = new Set(colegiosCiclo.map(c => c.colegio));
        
        let metaAsistencias = 0;
        colegiosCiclo.forEach(c => { 
            const docs = parseInt(c.docentes) || 0;
            const clasif = c.clasificacion ? c.clasificacion.toUpperCase().trim() : '';
            const multiplicador = BusinessRules.metasCiclo[clasif] || 1;
            metaAsistencias += (docs * multiplicador); 
        });

        const docs = data.filter(d => d.perfil === 'Docente').length; const dirs = data.filter(d => d.perfil === 'Directivo').length;
        const asistenciasReales = data.filter(d => nombresColegiosCiclo.has(d.colegio)).length; 
        const avanceCiclo = metaAsistencias > 0 ? ((asistenciasReales / metaAsistencias) * 100).toFixed(1) : 0;
        
        document.getElementById('dash_docentes').innerText = docs; document.getElementById('dash_meta_docentes').innerText = metaAlcance === 0 ? "0" : metaAlcance;
        document.getElementById('dash_avance_porcentaje').innerText = avanceCiclo + '%'; document.getElementById('dash_asistencias_reales').innerText = asistenciasReales;
        document.getElementById('dash_asistencias_meta').innerText = metaAsistencias === 0 ? "0" : metaAsistencias;
        document.getElementById('dash_directivos').innerText = dirs;
        document.getElementById('dash_cobertura_colegios').innerText = new Set(data.map(d => d.colegio)).size; document.getElementById('dash_total_colegios').innerText = masterFilter.length;

        const calc = (key) => (data.reduce((s, d) => s + d[key], 0) / (data.length || 1)).toFixed(1);
        ['q6', 'q7', 'q8', 'q9'].forEach(q => { const val = calc(q); document.getElementById(`avg_${q}`).innerText = val; document.getElementById(`bar_${q}`).style.width = (val / 5 * 100) + '%'; });

        let totalRespuestas = 0; let excelentes = 0;
        data.forEach(d => { [d.q6, d.q7, d.q8, d.q9].forEach(score => { totalRespuestas++; if(score >= 4) excelentes++; }); });
        const csatScore = totalRespuestas > 0 ? Math.round((excelentes / totalRespuestas) * 100) : 0;
        const circle = document.getElementById('csat_path'); const text = document.getElementById('csat_text');
        if (circle && text) { circle.setAttribute('stroke-dasharray', `${csatScore}, 100`); text.textContent = `${csatScore}%`; circle.setAttribute('stroke', csatScore >= 80 ? '#16a34a' : csatScore >= 60 ? '#ca8a04' : '#dc2626'); }

        const rList = document.getElementById('rubrica_list');
        if (data.length === 0) rList.innerHTML = '<div class="flex items-center justify-center h-full text-gray-400 italic text-sm">Esperando datos...</div>';
        else {
            const evalRubric = (score, label) => {
                const s = parseFloat(score); let status, color, icon, rec;
                if (s >= 4.5) { status = "Excelente"; color = "text-green-700 bg-green-50 border-green-200"; icon = "fa-star"; rec = "Práctica consolidada."; } 
                else if (s >= 3.8) { status = "Buen Desempeño"; color = "text-blue-700 bg-blue-50 border-blue-200"; icon = "fa-thumbs-up"; rec = "Resultados positivos."; } 
                else { status = "Oportunidad de Mejora"; color = "text-red-700 bg-red-50 border-red-200"; icon = "fa-triangle-exclamation"; rec = "Atención requerida."; }
                return `<div class="p-4 rounded-xl border ${color} flex gap-4 items-start"><div class="text-2xl mt-1 opacity-70"><i class="fa-solid ${icon}"></i></div><div><p class="font-bold text-sm mb-1">${label} <span class="ml-2 inline-block px-2 py-0.5 bg-white rounded-full text-xs font-black shadow-sm">${s.toFixed(1)}</span></p><p class="text-xs opacity-90"><b>${status}:</b> ${rec}</p></div></div>`;
            };
            rList.innerHTML = `${evalRubric(calc('q6'), 'Conocimiento')}${evalRubric(calc('q7'), 'Utilidad')}${evalRubric(calc('q8'), 'Metodología')}${evalRubric(calc('q9'), 'Recursos')}`;
        }

        if (State.currentUserRole === 'admin') {
            const monthlyData = {};
            data.forEach(d => {
                let dateObj;
                if (d.timestamp) dateObj = new Date(d.timestamp);
                else { const parts = d.fecha.split(',')[0].trim().split('/'); if(parts.length === 3) dateObj = new Date(parts[2], parts[1]-1, parts[0]); else dateObj = new Date(d.fecha); }
                if (dateObj && !isNaN(dateObj.getTime())) {
                    const monthYear = `${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getFullYear()}`; 
                    if(!monthlyData[monthYear]) monthlyData[monthYear] = { sum: 0, count: 0 };
                    monthlyData[monthYear].sum += (d.q6 + d.q7 + d.q8 + d.q9) / 4; monthlyData[monthYear].count++;
                }
            });
            const labels = Object.keys(monthlyData).sort((a,b) => { const [m1,y1] = a.split('/'); const [m2,y2] = b.split('/'); return new Date(y1, m1-1) - new Date(y2, m2-1); });
            const ctx = document.getElementById('trendChart');
            if(ctx) {
                if(window.trendChartInst) window.trendChartInst.destroy();
                window.trendChartInst = new Chart(ctx, { type: 'line', data: { labels: labels, datasets: [{ data: labels.map(l => (monthlyData[l].sum / monthlyData[l].count).toFixed(2)), borderColor: '#FF5A00', backgroundColor: 'rgba(255, 90, 0, 0.1)', borderWidth: 3, pointBackgroundColor: '#002C5F', pointRadius: 4, fill: true, tension: 0.3 }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 1, max: 5 } }, plugins: { legend: { display: false } } } });
            }
        }

        const buildRanking = (keyProp) => {
            const rankMap = {};
            data.forEach(d => { if(!d[keyProp]) return; if(!rankMap[d[keyProp]]) rankMap[d[keyProp]] = { sum: 0, count: 0 }; rankMap[d[keyProp]].sum += (d.q6 + d.q7 + d.q8 + d.q9) / 4; rankMap[d[keyProp]].count++; });
            const arr = Object.keys(rankMap).map(k => ({ name: k, score: rankMap[k].sum / rankMap[k].count, count: rankMap[k].count })).filter(x => x.count > 0).sort((a,b) => b.score - a.score);
            if (arr.length === 0) return '<div class="text-center text-xs text-gray-400 italic py-4">Sin datos.</div>';
            let html = '';
            arr.slice(0, 10).forEach((item, idx) => { html += `<div class="flex justify-between items-center p-2 rounded-lg border border-gray-50 hover:bg-gray-50"><div class="flex items-center gap-2 overflow-hidden"><span class="w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-black bg-gray-100">${idx+1}</span><div class="truncate"><p class="text-xs font-bold text-gray-700">${item.name}</p></div></div><div class="text-xs font-black ${item.score >= 4.0 ? 'text-[#002C5F] bg-blue-50' : 'text-red-700 bg-red-50'} px-2 py-1 rounded ml-2">${item.score.toFixed(1)}</div></div>`; });
            return html;
        };
        if (State.currentUserRole === 'admin') document.getElementById('ranking_list_coach').innerHTML = buildRanking('coach');
        document.getElementById('ranking_list_regional').innerHTML = buildRanking('regional');

        const detractores = data.filter(d => d.q6 <= 2 || d.q7 <= 2 || d.q8 <= 2 || d.q9 <= 2);
        document.getElementById('detractores_badge').innerText = `${detractores.length} Casos`;
        const dList = document.getElementById('detractores_list');
        if (detractores.length === 0) dList.innerHTML = '<div class="text-center text-green-600 py-6 font-bold">¡Sin alertas críticas!</div>';
        else {
            dList.innerHTML = '';
            detractores.forEach(d => {
                let f = "Sin fecha"; if(d.timestamp) { const o = new Date(d.timestamp); f = `${o.getDate()}/${o.getMonth() + 1}/${o.getFullYear()}`; } else if(d.fecha) f = d.fecha.split(',')[0];
                dList.innerHTML += `<div class="p-4 bg-red-50 rounded-xl border border-red-100 flex flex-col sm:flex-row justify-between gap-4"><div class="flex-1"><div class="flex items-center gap-2 mb-2"><span class="px-2 py-1 bg-red-600 text-white rounded text-[10px] font-black">Min: ${Math.min(d.q6, d.q7, d.q8, d.q9)}</span><p class="font-bold text-red-900 text-sm">${d.colegio}</p></div><p class="italic text-gray-800 text-sm">"${d.sugerencias || ''}"</p></div><div class="text-right text-[10px] text-gray-500"><p class="font-bold text-gray-700">${State.currentUserRole === 'admin' ? d.asistente : 'Anónimo'}</p><p>${f}</p></div></div>`;
            });
        }
        this.renderRegistrosTable();
    },

    populateRegistrosFilters: function() {
        const regSel = document.getElementById('reg_filter_regional'); const colSel = document.getElementById('reg_filter_colegio'); const coachSel = document.getElementById('reg_filter_coach');
        if (!colSel) return;
        const datosEnriquecidos = State.encuestasData.map(d => { const col = State.colegiosBD.find(c => c.colegio === d.colegio); return { ...d, regional: col ? col.regional : 'Sin Regional' }; });
        const updateSelect = (el, data, currVal, text) => { el.innerHTML = `<option value="">${text}</option>`; data.forEach(v => el.innerHTML += `<option value="${v}">${v}</option>`); el.value = currVal; };
        updateSelect(regSel, [...new Set(datosEnriquecidos.map(d => d.regional))].sort(), regSel.value, "Todas");
        updateSelect(colSel, [...new Set(datosEnriquecidos.map(d => d.colegio))].sort(), colSel.value, "Todos los Colegios");
        if (State.currentUserRole === 'admin') updateSelect(coachSel, [...new Set(datosEnriquecidos.map(d => d.coach))].sort(), coachSel.value, "Todos los Coaches");
        else { coachSel.innerHTML = `<option value="${State.loginUser.nombre}">${State.loginUser.nombre}</option>`; coachSel.disabled = true; }
    },

    renderRegistrosTable: function() {
        this.populateRegistrosFilters();
        const fechaVal = document.getElementById('reg_filter_fecha').value; const regVal = document.getElementById('reg_filter_regional').value;
        const colVal = document.getElementById('reg_filter_colegio').value; const tallerVal = document.getElementById('reg_filter_taller').value;
        const coachVal = document.getElementById('reg_filter_coach').value;
        let data = State.encuestasData.map(d => { const col = State.colegiosBD.find(c => c.colegio === d.colegio); return { ...d, regional: col ? col.regional : 'Sin Regional' }; });
        
        if (fechaVal) { const p = fechaVal.split('-'); const sd = `${parseInt(p[2])}/${parseInt(p[1])}/${p[0]}`; data = data.filter(d => { let f = ""; if (d.timestamp) { const o = new Date(d.timestamp); f = `${o.getDate()}/${o.getMonth() + 1}/${o.getFullYear()}`; } else if (d.fecha) f = d.fecha.split(',')[0].trim(); return f === sd || f === `${p[2]}/${p[1]}/${p[0]}`; }); }
        if (regVal) data = data.filter(d => d.regional === regVal); if (colVal) data = data.filter(d => d.colegio === colVal);
        if (tallerVal) data = data.filter(d => d.numTaller === tallerVal); if (coachVal && State.currentUserRole === 'admin') data = data.filter(d => d.coach === coachVal);
        if (State.currentUserRole === 'coach') data = data.filter(d => d.coach === State.loginUser.nombre);
        State.registrosFiltrados = data;

        const tHead = document.getElementById('tabla_registros_head'); const tBody = document.getElementById('tabla_registros');
        tHead.innerHTML = `<tr><th class="px-6 py-4">Fecha</th><th class="px-6 py-4">Colegio</th><th class="px-6 py-4">Taller</th>${State.currentUserRole === 'admin' ? '<th class="px-6 py-4">Asistente</th>' : ''}<th class="px-6 py-4">Perfil</th><th class="px-6 py-4">Coach</th><th class="px-6 py-4 text-center">Promedio</th><th class="px-6 py-4 min-w-[250px]">Sugerencias</th></tr>`;
        tBody.innerHTML = '';
        if (data.length === 0) { tBody.innerHTML = `<tr><td colspan="8" class="px-6 py-8 text-center text-gray-400 italic">No hay registros.</td></tr>`; return; }

        [...data].reverse().forEach(d => {
            const avg = ((d.q6 + d.q7 + d.q8 + d.q9) / 4).toFixed(1);
            let f = "Fecha no válida"; if (d.timestamp) { const o = new Date(d.timestamp); f = `${o.getDate().toString().padStart(2, '0')}/${(o.getMonth() + 1).toString().padStart(2, '0')}/${o.getFullYear()}`; } else if (d.fecha) f = d.fecha.split(',')[0].trim();
            tBody.innerHTML += `<tr class="hover:bg-orange-50 transition-colors border-b border-gray-100"><td class="px-6 py-4 text-xs whitespace-nowrap text-gray-500">${f}</td><td class="px-6 py-4"><div class="font-bold text-xs text-[#002C5F]">${d.colegio}</div><div class="text-[9px] text-gray-400 mt-0.5">${d.regional}</div></td><td class="px-6 py-4 text-[10px] text-gray-600 font-medium">${d.numTaller}: ${d.taller}</td>${State.currentUserRole === 'admin' ? `<td class="px-6 py-4 text-xs font-bold text-gray-700">${d.asistente}</td>` : ''}<td class="px-6 py-4"><span class="px-2 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase bg-blue-100">${d.perfil}</span></td><td class="px-6 py-4 text-xs whitespace-nowrap font-medium text-gray-700">${d.coach}</td><td class="px-6 py-4 text-center"><span class="px-2 py-1 rounded font-black text-xs border shadow-sm flex items-center justify-center gap-1 w-14 mx-auto ${avg >= 4.0 ? 'text-green-700 bg-green-50' : avg >= 3.0 ? 'text-yellow-700 bg-yellow-50' : 'text-red-700 bg-red-50'}">${avg}</span></td><td class="px-6 py-4 text-xs text-gray-600 italic break-words">${d.sugerencias || 'Sin comentarios'}</td></tr>`;
        });
    },

    exportToExcel: function() {
        const list = State.registrosFiltrados && State.registrosFiltrados.length > 0 ? State.registrosFiltrados : State.filteredEncuestas;
        if (!list || list.length === 0) { alert("No hay datos para exportar."); return; }
        const data = list.map(d => {
            let f = "Sin Fecha"; if (d.timestamp) { const o = new Date(d.timestamp); f = `${o.getDate()}/${(o.getMonth() + 1)}/${o.getFullYear()}`; } else if (d.fecha) f = d.fecha.split(',')[0].trim();
            return { id: d.id, fecha: f, ciclo: d.ciclo, regional: d.regional || 'Sin Regional', colegio: d.colegio, asistente: d.asistente, perfil: d.perfil, coach: d.coach, numTaller: d.numTaller, taller: d.taller, q6: d.q6, q7: d.q7, q8: d.q8, q9: d.q9, sugerencias: d.sugerencias };
        });
        const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Reporte"); XLSX.writeFile(wb, "Reporte_Encuestas_Santillana.xlsx");
    },

    showAvanceExplanation: function() { App.showModal('Sobre el Avance del Ciclo Anual', `<div class="space-y-4 text-sm"><p>El <strong>Avance del Ciclo Anual</strong> mide la profundidad de nuestro acompañamiento.</p><div class="bg-green-50 p-4 rounded-xl">Colegios AAA: 6 talleres | Colegios Ri: 4 talleres | Colegios AA: 3 talleres.</div></div>`, '<button onclick="App.hideModal()" class="px-6 py-2 bg-green-600 text-white rounded-xl">Entendido</button>'); },
    showExcelenciaExplanation: function() { App.showModal('Sobre el Índice de Excelencia', `<div class="space-y-4 text-sm"><p>Porcentaje de calificaciones 4 y 5 en la encuesta.</p></div>`, '<button onclick="App.hideModal()" class="px-6 py-2 bg-[#FF5A00] text-white rounded-xl">Entendido</button>'); },
    mostrarEstadoCobertura: function() { App.showModal(`Estado de Cobertura`, `<p class="mb-4 text-sm text-gray-600">Estado de colegios asignados:</p>`, `<button onclick="App.hideModal()" class="px-6 py-2 bg-[#002C5F] text-white rounded-xl font-bold">Cerrar</button>`); },

    submitForm: async function(e) {
        e.preventDefault();
        const inputColegio = document.getElementById('q1_colegio').value;
        if (!State.colegiosBD.some(c => c.colegio === inputColegio)) { alert("⚠️ Por favor, selecciona un colegio válido de la lista desplegable."); return; }
        const btn = document.getElementById('btnSubmitForm'); btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Guardando en la nube...';
        const formData = {
            fecha: new Date().toLocaleDateString('es-CO'), timestamp: Date.now(), ciclo: document.getElementById('ciclo').value,
            colegio: inputColegio, asistente: document.getElementById('q2_asistente').value, perfil: document.querySelector('input[name="q3_perfil"]:checked').value,
            coach: document.getElementById('q4_coach').value, numTaller: document.getElementById('q5_numTaller').value, taller: document.getElementById('q5_taller').value,
            q6: parseInt(document.querySelector('input[name="q6"]:checked').value), q7: parseInt(document.querySelector('input[name="q7"]:checked').value), q8: parseInt(document.querySelector('input[name="q8"]:checked').value), q9: parseInt(document.querySelector('input[name="q9"]:checked').value),
            sugerencias: document.getElementById('q10_sugerencias').value
        };
        try {
            const docRef = await addDoc(collection(db, "encuestas"), formData); State.encuestasData.push({ id: docRef.id, ...formData });
            document.getElementById('encuestaForm').reset(); document.getElementById('successMsg').classList.remove('hidden'); window.scrollTo({ top: 0, behavior: 'smooth' });
            setTimeout(() => document.getElementById('successMsg').classList.add('hidden'), 5000);
            
            try {
                const resumenRef = doc(db, "metricas", "resumen_global");
                await updateDoc(resumenRef, { total_encuestas: increment(1) });
            } catch (e) {
                if (e.code === 'not-found') await setDoc(doc(db, "metricas", "resumen_global"), { total_encuestas: 1 });
            }

            if (State.currentUserRole) App.handleFilterTrigger(); 
        } catch (error) { alert("Hubo un error guardando la encuesta. Intenta de nuevo."); } finally { btn.disabled = false; btn.innerHTML = '<span>Enviar Feedback</span>'; }
    },

    handleColegioInput: function() {
        const val = document.getElementById('q1_colegio').value.toLowerCase(); const list = document.getElementById('listaColegiosCustom'); list.innerHTML = '';
        if(!val) { list.classList.add('hidden'); return; }
        const matches = State.colegiosBD.filter(c => (c.colegio || '').toLowerCase().includes(val)).slice(0, 10);
        if(matches.length > 0) {
            matches.forEach(m => {
                const li = document.createElement('li'); li.className = 'px-4 py-3 hover:bg-orange-50 cursor-pointer text-sm border-b flex justify-between'; li.innerHTML = `<span>${m.colegio}</span> <span class="text-[10px] text-gray-400 font-bold">${m.regional}</span>`;
                li.onclick = () => { document.getElementById('q1_colegio').value = m.colegio; document.getElementById('q4_coach').value = m.coach; list.classList.add('hidden'); }; list.appendChild(li);
            }); list.classList.remove('hidden');
        } else list.classList.add('hidden');
    },

    poblarCoaches: function() { const sel = document.getElementById('q4_coach'); if(sel) { sel.innerHTML = '<option value="">Seleccione coach...</option>'; [...new Set(State.colegiosBD.map(c => c.coach).filter(Boolean))].sort().forEach(c => sel.innerHTML += `<option value="${c}">${c}</option>`); } },
    openImportModal: function() { this.showModal("Importar", `<div class="flex gap-4 pt-2"><button onclick="App.downloadEncuestaTemplate()" class="flex-1 py-3 bg-gray-100 rounded-xl">Plantilla</button><button onclick="document.getElementById('fileImportEncuestas').click()" class="flex-1 py-3 bg-[#002C5F] text-white rounded-xl">Subir Excel</button></div>`, `<button onclick="App.hideModal()" class="px-6 py-2 bg-gray-200 rounded-xl">Cerrar</button>`); },
    downloadEncuestaTemplate: function() { const ws = XLSX.utils.json_to_sheet([{ id: "DEJAR_VACIO_NUEVO_REGISTRO", fecha: new Date().toLocaleDateString('es-CO'), ciclo: "Ciclo Inclusión", colegio: "COLEGIO DE EJEMPLO", asistente: "Juan", perfil: "Docente", coach: "Coach X", numTaller: "Taller 1", taller: "Tema Y", q6: 5, q7: 4, q8: 5, q9: 5, sugerencias: "Buen taller." }]); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Encuestas"); XLSX.writeFile(wb, "Plantilla_Encuestas.xlsx"); },
    clearData: async function() { if(!confirm("⚠️ PELIGRO: ¿Borrar todas las encuestas en la nube?")) return; try { const btn = document.getElementById('btn_clear_data'); btn.innerText = "Borrando..."; btn.disabled = true; for(const enc of State.encuestasData) await deleteDoc(doc(db, "encuestas", enc.id)); State.encuestasData = []; State.filteredEncuestas = []; this.updateDashboard(); alert("Borradas."); } catch(e) { alert("Error"); } finally { document.getElementById('btn_clear_data').innerHTML = 'Borrar Todo'; document.getElementById('btn_clear_data').disabled = false; } },
    showModal: function(title, body, footer) { document.getElementById('modalHeader').innerText = title; document.getElementById('modalBody').innerHTML = body; document.getElementById('modalFooter').innerHTML = footer; document.getElementById('customModal').classList.remove('hidden'); },
    hideModal: function() { document.getElementById('customModal').classList.add('hidden'); },
    switchDashSubTab: function(id) { ['subTabResultados', 'subTabRegistros', 'subTabEdicion'].forEach(t => document.getElementById(t).classList.add('hidden')); document.getElementById(`subTab${id.charAt(0).toUpperCase() + id.slice(1)}`).classList.remove('hidden'); ['btn-sub-resultados', 'btn-sub-registros', 'btn-sub-edicion'].forEach(b => { const btn = document.getElementById(b); if(btn) btn.className = "py-2 px-6 rounded-lg text-sm font-bold transition-all text-gray-500 hover:bg-gray-50"; }); const activeBtn = document.getElementById(`btn-sub-${id}`); if(activeBtn) activeBtn.className = "py-2 px-6 rounded-lg text-sm font-bold transition-all bg-[#FF5A00] text-white"; if(id === 'edicion') document.getElementById('edicionTableContainer').classList.add('hidden'); },
    handleEdicionFilterTrigger: function() { this.refreshEdicionFilters(); this.renderActiveEdicionTable(); },
    refreshEdicionFilters: function() {
        let base = State.colegiosBD.filter(c => c.colegio !== "[NUEVO COACH SIN COLEGIO]");
        const regEl = document.getElementById('edicion_filter_regional'); const coachEl = document.getElementById('edicion_filter_coach');
        const updateDropdown = (el, validOptions, defaultText, currentVal) => { el.innerHTML = `<option value="">${defaultText}</option>`; validOptions.forEach(v => el.innerHTML += `<option value="${v}">${v}</option>`); if (validOptions.includes(currentVal)) el.value = currentVal; else el.value = ''; };
        updateDropdown(regEl, [...new Set(base.map(c => c.regional).filter(Boolean))].sort(), 'Todas las Regionales', regEl.value);
        updateDropdown(coachEl, [...new Set(base.map(c => c.coach).filter(Boolean))].sort(), 'Todos los Coaches', coachEl.value);
    },
    openEditView: function(view) {
        State.currentEdicionView = view;
        document.getElementById('edicionTableContainer').classList.remove('hidden'); document.getElementById('search_edicion').value = ''; 
        if(view === 'colegios') { document.getElementById('edicionTableTitle').innerHTML = '<i class="fa-solid fa-school mr-2"></i> Colegios'; document.getElementById('edicion_filters').classList.remove('hidden'); this.handleEdicionFilterTrigger(); } 
        else { document.getElementById('edicionTableTitle').innerHTML = '<i class="fa-solid fa-user-tie mr-2"></i> Coaches'; document.getElementById('edicion_filters').classList.add('hidden'); this.renderActiveEdicionTable(); }
        document.getElementById('edicionTableContainer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    renderActiveEdicionTable: function() {
        const head = document.getElementById('edicion_head'); const body = document.getElementById('edicion_body');
        const searchVal = document.getElementById('search_edicion').value.toLowerCase().trim();
        if(State.currentEdicionView === 'colegios') {
            const regVal = document.getElementById('edicion_filter_regional').value; const coachVal = document.getElementById('edicion_filter_coach').value;
            head.innerHTML = `<tr><th class="px-6 py-4">Colegio</th><th class="px-6 py-4">Regional</th><th class="px-6 py-4">Coach</th><th class="px-6 py-4 text-center">Acciones</th></tr>`; body.innerHTML = '';
            State.colegiosBD.forEach((c, idx) => {
                if ((searchVal === '' || (c.colegio||'').toLowerCase().includes(searchVal)) && (regVal === '' || c.regional === regVal) && (coachVal === '' || c.coach === coachVal)) {
                    body.innerHTML += `<tr class="hover:bg-gray-50 border-b"><td class="px-6 py-4 font-bold">${c.colegio}</td><td class="px-6 py-4">${c.regional}</td><td class="px-6 py-4">${c.coach}</td><td class="px-6 py-4 text-center"><button onclick="App.openEditColegioModal(${idx})" class="text-blue-500 mx-1"><i class="fa-solid fa-pen"></i></button><button onclick="App.deleteColegio(${idx})" class="text-red-500 mx-1"><i class="fa-solid fa-trash"></i></button></td></tr>`;
                }
            });
        } else {
            head.innerHTML = `<tr><th class="px-6 py-4">Coach</th><th class="px-6 py-4">Email</th><th class="px-6 py-4">Regional</th><th class="px-6 py-4 text-center">Acciones</th></tr>`; body.innerHTML = '';
            State.coachesAuth.forEach((c, idx) => {
                if (searchVal === '' || (c.nombre||'').toLowerCase().includes(searchVal) || (c.email||'').toLowerCase().includes(searchVal)) {
                    body.innerHTML += `<tr class="hover:bg-gray-50 border-b"><td class="px-6 py-4 font-bold">${c.nombre}</td><td class="px-6 py-4">${c.email}</td><td class="px-6 py-4">${c.regional}</td><td class="px-6 py-4 text-center"><button onclick="App.openEditCoachModal(${idx})" class="text-blue-500 mx-1"><i class="fa-solid fa-pen"></i></button><button onclick="App.deleteCoach(${idx})" class="text-red-500 mx-1"><i class="fa-solid fa-trash"></i></button></td></tr>`;
                }
            });
        }
    },
    deleteColegio: async function(idx) { if(!confirm("¿Borrar colegio?")) return; try { await deleteDoc(doc(db, "colegios", State.colegiosBD[idx].id)); State.colegiosBD.splice(idx, 1); localStorage.removeItem('santillana_cache_time'); this.renderActiveEdicionTable(); } catch(e) { alert("Error"); } },
    deleteCoach: async function(idx) { if(!confirm("¿Borrar coach?")) return; try { await deleteDoc(doc(db, "coaches", State.coachesAuth[idx].id)); State.coachesAuth.splice(idx, 1); localStorage.removeItem('santillana_cache_time'); this.renderActiveEdicionTable(); } catch(e) { alert("Error"); } },
    openEditColegioModal: function(idx) {
        const isEdit = idx >= 0; const data = isEdit ? State.colegiosBD[idx] : { colegio: '', regional: '', coach: '', docentes: 0, calendario: 'A', lineaNegocio: 'Compartir', clasificacion: 'AA' };
        let regOptions = '<option value="">Seleccione Regional...</option>'; [...new Set(State.coachesAuth.map(c => c.regional))].sort().forEach(r => regOptions += `<option value="${r}" ${data.regional === r ? 'selected' : ''}>${r}</option>`);
        this.showModal(isEdit ? "Editar Institución" : "Nuevo Colegio", `<div class="space-y-4"><div><label class="text-xs font-bold">Nombre</label><input type="text" id="edit_col_nombre" value="${data.colegio}" class="w-full border rounded-xl px-4 py-2"></div><div class="grid grid-cols-2 gap-4"><div><label class="text-xs font-bold">Regional</label><select id="edit_col_reg" onchange="App.updateCoachOptionsEdit()" class="w-full border rounded-xl px-4 py-2">${regOptions}</select></div><div><label class="text-xs font-bold">Coach</label><select id="edit_col_coach" class="w-full border rounded-xl px-4 py-2"><option value="${data.coach || ''}">${data.coach || 'Seleccione...'}</option></select></div></div><div class="grid grid-cols-2 gap-4 border-t pt-4"><div><label class="text-[10px] font-bold">Docentes</label><input type="number" id="edit_col_docentes" value="${data.docentes || 0}" class="w-full border rounded-xl px-4 py-2"></div><div><label class="text-[10px] font-bold">Clasificación</label><input type="text" id="edit_col_clasif" value="${data.clasificacion || ''}" class="w-full border rounded-xl px-4 py-2"></div></div></div>`, `<button onclick="App.hideModal()" class="px-6 py-2 bg-gray-200 rounded-xl">Cancelar</button><button onclick="App.saveEditColegio(${idx})" class="px-6 py-2 bg-[#FF5A00] text-white rounded-xl">Guardar</button>`);
        if (isEdit) this.updateCoachOptionsEdit(data.coach);
    },
    openEditCoachModal: function(idx) {
        const data = State.coachesAuth[idx];
        this.showModal("Editar Coach", `<div class="space-y-4"><div><label class="text-xs font-bold">Nombre</label><input type="text" id="edit_coach_nombre" value="${data.nombre}" class="w-full border rounded-xl px-4 py-2"></div><div><label class="text-xs font-bold">Email</label><input type="email" id="edit_coach_email" value="${data.email}" class="w-full border rounded-xl px-4 py-2"></div><div class="grid grid-cols-2 gap-4"><div><label class="text-xs font-bold">Regional</label><input type="text" id="edit_coach_regional" value="${data.regional}" class="w-full border rounded-xl px-4 py-2"></div><div><label class="text-xs font-bold">Contraseña</label><input type="text" id="edit_coach_pass" value="${data.pass || ''}" class="w-full border rounded-xl px-4 py-2"></div></div></div>`, `<button onclick="App.hideModal()" class="px-6 py-2 bg-gray-200 rounded-xl">Cancelar</button><button onclick="App.saveEditCoach(${idx})" class="px-6 py-2 bg-[#002C5F] text-white rounded-xl">Guardar</button>`);
    },
    updateCoachOptionsEdit: function(selectedCoach = '') {
        const reg = document.getElementById('edit_col_reg').value; const selCoach = document.getElementById('edit_col_coach'); selCoach.innerHTML = '<option value="">Seleccione Coach...</option>';
        if (!reg) return; State.coachesAuth.filter(c => c.regional === reg).forEach(c => selCoach.innerHTML += `<option value="${c.nombre}" ${c.nombre === selectedCoach ? 'selected' : ''}>${c.nombre}</option>`);
    },
    saveEditColegio: async function(idx) {
        const colData = { colegio: document.getElementById('edit_col_nombre').value.trim().toUpperCase(), regional: document.getElementById('edit_col_reg').value, coach: document.getElementById('edit_col_coach').value, docentes: parseInt(document.getElementById('edit_col_docentes').value) || 0, clasificacion: document.getElementById('edit_col_clasif').value.trim() };
        if(!colData.colegio || !colData.regional || !colData.coach) { alert("Completa Nombre, Regional y Coach."); return; }
        try { if(idx === -1) { const docRef = await addDoc(collection(db, "colegios"), colData); State.colegiosBD.unshift({ id: docRef.id, ...colData }); } else { const colId = State.colegiosBD[idx].id; await setDoc(doc(db, "colegios", colId), colData); State.colegiosBD[idx] = { id: colId, ...colData }; } localStorage.removeItem('santillana_cache_time'); this.hideModal(); this.renderActiveEdicionTable(); this.handleFilterTrigger(); } catch (e) { alert("Error al guardar."); }
    },
    saveEditCoach: async function(idx) {
        const coachData = { nombre: document.getElementById('edit_coach_nombre').value.trim(), email: document.getElementById('edit_coach_email').value.trim().toLowerCase(), regional: document.getElementById('edit_coach_regional').value.trim(), pass: document.getElementById('edit_coach_pass').value.trim() };
        if(!coachData.nombre || !coachData.email || !coachData.regional) { alert("Faltan datos."); return; }
        try { const coachId = State.coachesAuth[idx].id; await setDoc(doc(db, "coaches", coachId), coachData); State.coachesAuth[idx] = { id: coachId, ...coachData }; localStorage.removeItem('santillana_cache_time'); this.hideModal(); this.renderActiveEdicionTable(); this.poblarCoaches(); } catch (e) { alert("Error al guardar."); }
    },
    exportData: function(type) {
        let data = type === 'colegios' ? State.colegiosBD : State.coachesAuth; let sheetName = type === 'colegios' ? "Colegios_BD" : "Coaches_Auth";
        const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheetName); XLSX.writeFile(wb, `BaseDatos_${type}.xlsx`);
    }
};

function initRatings() { ['q6', 'q7', 'q8', 'q9'].forEach(q => { const container = document.getElementById(`${q}_group`); for(let i=1; i<=5; i++) container.innerHTML += `<label class="rating-label"><input type="radio" name="${q}" value="${i}" required><span class="text-xs mt-1">${i}</span></label>`; }); }

document.getElementById('fileImportColegios').addEventListener('change', (e) => {
    const file = e.target.files[0]; if(!file) return; const reader = new FileReader();
    reader.onload = async (evt) => {
        App.showModal("Sincronizando...", "<div class='text-center py-4'><span class='loader'></span><p class='mt-4'>Procesando...</p></div>", "");
        try {
            const wb = XLSX.read(evt.target.result, {type: 'binary'}); let data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
            for (const col of data) {
                const cleanCol = { ...col }; delete cleanCol.id; 
                const existingIdx = State.colegiosBD.findIndex(c => c.colegio.toLowerCase() === cleanCol.colegio.toLowerCase());
                if (existingIdx >= 0) { const docId = State.colegiosBD[existingIdx].id; await setDoc(doc(db, "colegios", docId), cleanCol); State.colegiosBD[existingIdx] = { id: docId, ...cleanCol }; } 
                else { const docRef = await addDoc(collection(db, "colegios"), cleanCol); State.colegiosBD.push({ id: docRef.id, ...cleanCol }); }
            }
            localStorage.removeItem('santillana_cache_time');
            App.hideModal(); if(State.currentEdicionView === 'colegios') App.renderActiveEdicionTable(); alert("Base actualizada.");
        } catch(err) { App.hideModal(); alert("Error"); }
    }; reader.readAsBinaryString(file); e.target.value = null;
});

document.getElementById('fileImportCoaches').addEventListener('change', (e) => {
    const file = e.target.files[0]; if(!file) return; const reader = new FileReader();
    reader.onload = async (evt) => {
        App.showModal("Sincronizando...", "<div class='text-center py-4'><span class='loader'></span><p class='mt-4'>Procesando...</p></div>", "");
        try {
            const wb = XLSX.read(evt.target.result, {type: 'binary'}); const importedCoaches = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
            for (const newCoach of importedCoaches) {
                const coachExistenteIdx = State.coachesAuth.findIndex(c => c.email.toLowerCase() === newCoach.email.trim().toLowerCase());
                if (coachExistenteIdx >= 0) { const docId = State.coachesAuth[coachExistenteIdx].id; const passActual = State.coachesAuth[coachExistenteIdx].pass; const updatedData = { ...newCoach, pass: passActual }; delete updatedData.id; await setDoc(doc(db, "coaches", docId), updatedData); State.coachesAuth[coachExistenteIdx] = { id: docId, ...updatedData }; } 
                else { const cleanCoach = {...newCoach}; if(!cleanCoach.pass) cleanCoach.pass = '12345'; delete cleanCoach.id; const docRef = await addDoc(collection(db, "coaches"), cleanCoach); State.coachesAuth.push({ id: docRef.id, ...cleanCoach }); }
            }
            localStorage.removeItem('santillana_cache_time');
            App.hideModal(); if(State.currentEdicionView === 'coaches') App.renderActiveEdicionTable(); alert("Coaches actualizados.");
        } catch(err) { App.hideModal(); alert("Error"); }
    }; reader.readAsBinaryString(file); e.target.value = null;
});

document.getElementById('fileImportEncuestas').addEventListener('change', (e) => {
    const file = e.target.files[0]; if(!file) return; const reader = new FileReader();
    reader.onload = async (evt) => {
        App.showModal("Sincronizando...", "<div class='text-center py-4'><span class='loader'></span></div>", "");
        try {
            const wb = XLSX.read(evt.target.result, {type: 'binary'}); const importedData = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
            for(const row of importedData) {
                if (!row.colegio || !row.coach) continue; 
                if (row.id && row.id !== "DEJAR_VACIO_NUEVO_REGISTRO") {
                    const existingIdx = State.encuestasData.findIndex(d => d.id === row.id.toString());
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
    App.poblarCoaches();

    window.addEventListener('click', function(e) {
        const dropColegios = document.getElementById('listaColegiosCustom'); const inputColegio = document.getElementById('q1_colegio');
        if (dropColegios && inputColegio && !dropColegios.contains(e.target) && e.target !== inputColegio) dropColegios.classList.add('hidden');
        const dropLineas = document.getElementById('dropdown_lineas'); const btnLineas = document.getElementById('btn_dropdown_lineas');
        if (dropLineas && btnLineas && !dropLineas.contains(e.target) && !btnLineas.contains(e.target)) dropLineas.classList.add('hidden');
    });
};
