// app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, where, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDrVXpZfLwn0iddsaQWyXzRCvZ0bXkwviA",
    authDomain: "encuesta-santillana.firebaseapp.com",
    projectId: "encuesta-santillana",
    storageBucket: "encuesta-santillana.firebasestorage.app",
    messagingSenderId: "354271667135",
    appId: "1:354271667135:web:9edb98cb6c5f868a7e370a"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const BusinessRules = { metasCiclo: { 'AAA': 6, 'RI': 4, 'AA': 3 } };

const State = {
    colegiosBD: [], coachesAuth: [], encuestasData: [], filteredEncuestas: [], registrosFiltrados: [],
    encuestasLoaded: false, currentUserRole: null, loginUser: null, currentView: 'formTab', currentEdicionView: 'colegios',
    paginationLimit: 50, currentRendered: 0 
};

const mesesNombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

async function initApp() {
    try {
        const cachedCol = localStorage.getItem('santillana_colegios');
        const cachedCoach = localStorage.getItem('santillana_coaches');
        const cacheTime = localStorage.getItem('santillana_cache_time');
        
        const isCacheValid = cacheTime && (Date.now() - parseInt(cacheTime) < 86400000);

        if (cachedCol && cachedCoach && isCacheValid) {
            State.colegiosBD = JSON.parse(cachedCol);
            State.coachesAuth = JSON.parse(cachedCoach);
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
        localStorage.setItem('santillana_cache_time', Date.now().toString());
        
        App.poblarCoaches();

    } catch (error) {
        console.error("Error inicializando bases de datos:", error);
    }
}

async function fetchEncuestas() {
    if (State.encuestasLoaded) return;
    try {
        let q;
        if (State.currentUserRole === 'admin') {
            q = query(collection(db, "encuestas"));
        } else {
            q = query(collection(db, "encuestas"), where("coach", "==", State.loginUser.nombre));
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
                <input type="email" id="loginEmail" class="w-full border rounded-xl px-4 py-3" placeholder="Correo corporativo">
                <input type="password" id="loginPwd" class="w-full border rounded-xl px-4 py-3" placeholder="Contraseña">
                <p id="loginError" class="text-red-500 text-xs hidden font-bold"></p>
            </div>
        `, `<button onclick="App.hideModal()" class="px-6 py-2 bg-gray-100 rounded-xl font-bold">Cancelar</button>
            <button onclick="App.verifyLogin('${role}')" class="px-6 py-2 bg-orange-600 text-white rounded-xl font-bold">Entrar</button>`);
    },

    verifyLogin: async function(role) {
        const emailInput = document.getElementById('loginEmail').value.trim().toLowerCase();
        const passInput = document.getElementById('loginPwd').value;
        const errEl = document.getElementById('loginError');

        try {
            let userFound = null;

            if (role === 'admin') {
                if (emailInput === 'jbecerra@santillana.com' && passInput === 'admin123') {
                    userFound = { email: emailInput, nombre: 'JBECERRA' };
                } else {
                    throw new Error("Credenciales de administrador incorrectas.");
                }
            } else {
                const coachInfo = State.coachesAuth.find(c => c.email && c.email.toLowerCase() === emailInput);
                if (!coachInfo) throw new Error("Correo no registrado como coach.");
                
                const validPass = coachInfo.pass || '12345'; 
                if (validPass !== passInput) throw new Error("Contraseña incorrecta.");
                
                userFound = coachInfo;
            }

            State.currentUserRole = role;
            State.loginUser = userFound;
            State.encuestasLoaded = false; 
            this.hideModal();
            
            document.getElementById('user-controls').classList.remove('hidden');
            document.getElementById('user-controls').classList.add('flex');
            document.getElementById('nav-user-name').innerText = State.loginUser.nombre;
            document.getElementById('nav-user-role').innerText = role;
            
            this.configureDashboardUI(role);
            this.switchTab('dashTab');
            this.initFiltrosBasicos();
            await fetchEncuestas();
            this.handleFilterTrigger();

        } catch (error) { 
            errEl.innerText = error.message;
            errEl.classList.remove('hidden'); 
        }
    },

    configureDashboardUI: function(role) {
        const isAdmin = role === 'admin';
        document.getElementById('adminSubNav').classList.toggle('hidden', !isAdmin);
        document.getElementById('coachWelcomeBar').classList.toggle('hidden', isAdmin);
        document.getElementById('container_filter_coach').classList.toggle('hidden', !isAdmin);
        
        document.getElementById('block_rank_coach').classList.toggle('hidden', !isAdmin);
        document.getElementById('dynamic_dashboard_grid').className = isAdmin ? 'grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6 mt-6' : 'grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6 mt-6';
        
        document.getElementById('coach_registros_box').classList.toggle('hidden', isAdmin);
        document.getElementById('container_reg_filter_regional').classList.toggle('hidden', !isAdmin);
        document.getElementById('container_reg_filter_coach').classList.toggle('hidden', !isAdmin);
        
        if(isAdmin) {
            document.getElementById('subTabRegistros_content').appendChild(document.getElementById('registros_core_container'));
        } else {
            document.getElementById('content_coach_registros').appendChild(document.getElementById('registros_core_container'));
        }
    },

    logout: function() {
        State.currentUserRole = null; State.loginUser = null; State.encuestasLoaded = false;
        State.encuestasData = []; State.filteredEncuestas = [];
        document.getElementById('user-controls').classList.add('hidden'); 
        document.getElementById('user-controls').classList.remove('flex');
        this.switchTab('formTab');
    },

    saveNewPassword: async function() {
        const p1 = document.getElementById('new_pass').value;
        const p2 = document.getElementById('new_pass_confirm').value;
        if(!p1 || p1 !== p2) { document.getElementById('pass_error').classList.remove('hidden'); return; }
        
        try {
            if (State.currentUserRole === 'coach') {
                const idx = State.coachesAuth.findIndex(c => c.email === State.loginUser.email);
                if(idx !== -1) { 
                    State.coachesAuth[idx].pass = p1; 
                    await setDoc(doc(db, "coaches", State.coachesAuth[idx].id), State.coachesAuth[idx]);
                    localStorage.setItem('santillana_coaches', JSON.stringify(State.coachesAuth));
                }
            } else {
                alert("La contraseña de Administrador no se puede cambiar desde este panel.");
            }
            App.showModal("Éxito", "<p>Tu contraseña ha sido actualizada en el sistema.</p>", `<button onclick="App.hideModal()" class="px-6 py-2 bg-[#002C5F] text-white rounded-xl font-bold">Aceptar</button>`);
        } catch (e) { 
            alert("Error actualizando la contraseña en la base de datos."); 
        }
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

    toggleDropdown: function(id, btnId) { 
        const el = document.getElementById(id); 
        const btn = document.getElementById(btnId);
        if (el) {
            const isHidden = el.classList.contains('hidden');
            if (isHidden) {
                el.classList.remove('hidden');
                el.setAttribute('aria-hidden', 'false');
                if(btn) btn.setAttribute('aria-expanded', 'true');
            } else {
                el.classList.add('hidden');
                el.setAttribute('aria-hidden', 'true');
                if(btn) btn.setAttribute('aria-expanded', 'false');
            }
        } 
    },

    initFiltrosBasicos: function() {
        const lineas = [...new Set(State.colegiosBD.map(c => c.lineaNegocio ? c.lineaNegocio.trim() : '').filter(Boolean))].sort();
        const dropLineas = document.getElementById('dropdown_lineas');
        if (dropLineas) {
            dropLineas.innerHTML = '';
            lineas.forEach(l => {
                dropLineas.innerHTML += `<label class="linea-label-container flex items-center space-x-2 p-2 hover:bg-orange-50 rounded-lg cursor-pointer transition-colors"><input type="checkbox" value="${l}" class="linea-cb accent-[#FF5A00] w-4 h-4" onchange="App.handleFilterTrigger()"><span class="text-xs font-medium text-gray-700">${l}</span></label>`;
            });
        }
        
        const dropMeses = document.getElementById('dropdown_meses');
        if (dropMeses) {
            dropMeses.innerHTML = '';
            mesesNombres.forEach((m, idx) => {
                dropMeses.innerHTML += `<label class="flex items-center space-x-2 p-2 hover:bg-blue-50 rounded-lg cursor-pointer transition-colors border border-transparent hover:border-blue-100"><input type="checkbox" value="${idx}" class="mes-cb accent-[#002C5F] w-4 h-4" onchange="App.handleFilterTrigger()"><span class="text-xs font-medium text-gray-700">${m}</span></label>`;
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
        try {
            const regF = document.getElementById('filter_regional')?.value || ""; 
            const coachF = State.currentUserRole === 'admin' ? (document.getElementById('filter_coach')?.value || "") : State.loginUser.nombre;
            const colF = document.getElementById('filter_colegio')?.value || ""; 
            const tallerF = document.getElementById('filter_taller')?.value || "";
            const calF = document.getElementById('filter_calendario')?.value || ""; 
            const clasF = document.getElementById('filter_clasificacion')?.value || "";
            const lineasF = Array.from(document.querySelectorAll('.linea-cb:checked')).map(cb => cb.value);
            const mesesF = Array.from(document.querySelectorAll('.mes-cb:checked')).map(cb => parseInt(cb.value));

            const textSpanMeses = document.getElementById('text_filter_meses');
            if(textSpanMeses) {
                if (mesesF.length === 0) textSpanMeses.textContent = "Todos los meses";
                else if (mesesF.length === 1) textSpanMeses.textContent = mesesNombres[mesesF[0]];
                else textSpanMeses.textContent = `${mesesF.length} meses seleccionados`;
            }

            // 1. Filtro Global (Ignora CoachF) para Ranking Regional Total
            let masterFilterGlobal = State.colegiosBD.filter(c => c.colegio !== "[NUEVO COACH SIN COLEGIO]");
            if(regF) masterFilterGlobal = masterFilterGlobal.filter(c => c.regional === regF);
            if(colF) masterFilterGlobal = masterFilterGlobal.filter(c => c.colegio === colF);
            if(calF) masterFilterGlobal = masterFilterGlobal.filter(c => c.calendario && c.calendario.trim().toUpperCase() === calF);
            if(clasF) masterFilterGlobal = masterFilterGlobal.filter(c => c.clasificacion === clasF);
            if(lineasF.length > 0) masterFilterGlobal = masterFilterGlobal.filter(c => c.lineaNegocio && lineasF.includes(c.lineaNegocio.trim()));
            
            // BLINDAJE: Transformamos todo a mayuscula para evitar errores de escritura
            const colegiosPermitidosGlobal = new Set(masterFilterGlobal.map(c => (c.colegio || "").trim().toUpperCase()));

            let dataGlobal = State.encuestasData.map(d => { 
                const colInfo = State.colegiosBD.find(c => (c.colegio || "").toUpperCase() === (d.colegio || "").toUpperCase()); 
                return { ...d, regional: colInfo ? colInfo.regional : 'Sin Regional' }; 
            });

            dataGlobal = dataGlobal.filter(d => {
                if (!colegiosPermitidosGlobal.has((d.colegio || "").trim().toUpperCase())) return false;
                if (regF && d.regional !== regF) return false;
                if (tallerF && d.numTaller !== tallerF) return false;

                // BLINDAJE FECHAS: Evitamos colapso si la fecha viene rota desde Excel
                if (mesesF.length > 0) {
                    let dateObj = null;
                    if (d.timestamp) { 
                        dateObj = new Date(d.timestamp); 
                    } else if (d.fecha) { 
                        const fechaStr = String(d.fecha);
                        const parts = fechaStr.split(',')[0].trim().split('/'); 
                        if(parts.length === 3) dateObj = new Date(parts[2], parts[1]-1, parts[0]); 
                        else dateObj = new Date(fechaStr); 
                    }
                    if (dateObj && !isNaN(dateObj.getTime())) {
                        if (!mesesF.includes(dateObj.getMonth())) return false;
                    }
                }
                return true;
            });

            // 2. Filtro Local (Aplica CoachF) para gráficos propios
            let data = [...dataGlobal];
            if (coachF) data = data.filter(d => d.coach === coachF);

            let masterFilter = [...masterFilterGlobal];
            if (coachF) masterFilter = masterFilter.filter(c => c.coach === coachF);

            State.filteredEncuestas = data; 

            const metaAlcance = masterFilter.reduce((s, c) => s + (parseInt(c.docentes || c.Docentes || c.DOCENTES) || 0), 0);
            const colegiosCiclo = masterFilter.filter(c => { const clasif = c.clasificacion ? c.clasificacion.toUpperCase().trim() : ''; return !clasif.includes('PRODUCTO'); });
            const nombresColegiosCiclo = new Set(colegiosCiclo.map(c => (c.colegio || "").toUpperCase()));
            
            let metaAsistencias = 0;
            colegiosCiclo.forEach(c => { 
                const docs = parseInt(c.docentes || c.Docentes || c.DOCENTES) || 0;
                const clasif = c.clasificacion ? c.clasificacion.toUpperCase().trim() : '';
                const multiplicador = BusinessRules.metasCiclo[clasif] || 1;
                metaAsistencias += (docs * multiplicador); 
            });

            const docs = data.filter(d => d.perfil === 'Docente').length; 
            const dirs = data.filter(d => d.perfil === 'Directivo').length;
            const asistenciasReales = data.filter(d => nombresColegiosCiclo.has((d.colegio || "").toUpperCase())).length; 
            const avanceCiclo = metaAsistencias > 0 ? ((asistenciasReales / metaAsistencias) * 100).toFixed(1) : 0;
            
            document.getElementById('dash_docentes').innerText = docs; 
            document.getElementById('dash_meta_docentes').innerText = metaAlcance === 0 ? "0" : metaAlcance;
            document.getElementById('dash_avance_porcentaje').innerText = avanceCiclo + '%'; 
            document.getElementById('dash_asistencias_reales').innerText = asistenciasReales;
            document.getElementById('dash_asistencias_meta').innerText = metaAsistencias === 0 ? "0" : metaAsistencias;
            document.getElementById('dash_directivos').innerText = dirs;
            document.getElementById('dash_cobertura_colegios').innerText = new Set(data.map(d => (d.colegio || "").toUpperCase())).size; 
            document.getElementById('dash_total_colegios').innerText = masterFilter.length;

            const calc = (key) => {
                let sum = 0, count = 0;
                data.forEach(d => {
                    const val = parseFloat(d[key] || d[key?.toUpperCase()]); 
                    if (!isNaN(val)) { sum += val; count++; }
                });
                return count === 0 ? "0.0" : (sum / count).toFixed(1);
            };

            ['q6', 'q7', 'q8', 'q9'].forEach(q => { 
                const val = calc(q); 
                const avgEl = document.getElementById(`avg_${q}`);
                const barEl = document.getElementById(`bar_${q}`);
                if(avgEl) avgEl.innerText = val; 
                if(barEl) barEl.style.width = (val / 5 * 100) + '%'; 
            });

            let totalRespuestas = 0; let excelentes = 0;
            data.forEach(d => { 
                ['q6', 'q7', 'q8', 'q9'].forEach(q => {
                    const score = parseFloat(d[q] || d[q?.toUpperCase()]);
                    if (!isNaN(score)) { totalRespuestas++; if(score >= 4) excelentes++; } 
                }); 
            });

            const csatScore = totalRespuestas > 0 ? Math.round((excelentes / totalRespuestas) * 100) : 0;
            const circle = document.getElementById('csat_path'); const text = document.getElementById('csat_text');
            if (circle && text) { circle.setAttribute('stroke-dasharray', `${csatScore}, 100`); text.textContent = `${csatScore}%`; circle.setAttribute('stroke', csatScore >= 80 ? '#16a34a' : csatScore >= 60 ? '#ca8a04' : '#dc2626'); }

            const buildRanking = (keyProp, dataset) => {
                const rankMap = {};
                dataset.forEach(d => { 
                    if(!d[keyProp]) return; 
                    let sum = 0, count = 0;
                    ['q6', 'q7', 'q8', 'q9'].forEach(q => {
                        const s = parseFloat(d[q] || d[q?.toUpperCase()]);
                        if(!isNaN(s)){ sum += s; count++; }
                    });
                    if(count > 0){
                        if(!rankMap[d[keyProp]]) rankMap[d[keyProp]] = { sum: 0, count: 0 }; 
                        rankMap[d[keyProp]].sum += (sum / count); 
                        rankMap[d[keyProp]].count++; 
                    }
                });
                const arr = Object.keys(rankMap).map(k => ({ name: k, score: rankMap[k].sum / rankMap[k].count, count: rankMap[k].count })).filter(x => x.count > 0).sort((a,b) => b.score - a.score);
                if (arr.length === 0) return '<div class="text-center text-xs text-gray-400 italic py-4">Sin datos.</div>';
                let html = '';
                arr.slice(0, 10).forEach((item, idx) => { html += `<div class="flex justify-between items-center p-2 rounded-lg border border-gray-50 hover:bg-gray-50"><div class="flex items-center gap-2 overflow-hidden"><span class="w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-black bg-gray-100">${idx+1}</span><div class="truncate"><p class="text-xs font-bold text-gray-700">${item.name}</p></div></div><div class="text-xs font-black ${item.score >= 4.0 ? 'text-[#002C5F] bg-blue-50' : 'text-red-700 bg-red-50'} px-2 py-1 rounded ml-2">${item.score.toFixed(1)}</div></div>`; });
                return html;
            };

            const rankCoachEl = document.getElementById('ranking_list_coach');
            if (State.currentUserRole === 'admin' && rankCoachEl) rankCoachEl.innerHTML = buildRanking('coach', data);
            
            const rankRegEl = document.getElementById('ranking_list_regional');
            if(rankRegEl) rankRegEl.innerHTML = buildRanking('regional', dataGlobal);

            // Lógica de Detractores ajustada
            const detractores = data.filter(d => {
                const scores = [parseFloat(d.q6), parseFloat(d.q7), parseFloat(d.q8), parseFloat(d.q9)].filter(s => !isNaN(s));
                return scores.some(s => s <= 2);
            });
            
            const detBadge = document.getElementById('detractores_badge');
            if(detBadge) detBadge.innerText = `${detractores.length}`;
            const dList = document.getElementById('detractores_list');
            
            if (dList) {
                if (detractores.length === 0) {
                    dList.innerHTML = '<div class="text-center text-green-600 py-6 font-bold">¡Sin alertas críticas!</div>';
                } else {
                    let detractoresHTML = '';
                    detractores.forEach(d => {
                        const scores = [parseFloat(d.q6), parseFloat(d.q7), parseFloat(d.q8), parseFloat(d.q9)].filter(s => !isNaN(s));
                        const minScore = scores.length > 0 ? Math.min(...scores) : 'N/A';
                        const f = d.timestamp ? new Date(d.timestamp).toLocaleDateString('es-CO') : (d.fecha ? String(d.fecha).split(',')[0] : 'Sin fecha');
                        
                        if (State.currentUserRole === 'admin') {
                            detractoresHTML += `
                            <div class="p-4 bg-red-50 rounded-xl border border-red-100 flex flex-col gap-3 hover:bg-red-100 transition-colors">
                                <div class="flex items-start gap-3">
                                    <span class="w-8 h-8 flex items-center justify-center bg-red-600 text-white rounded-lg text-sm font-black shadow-sm shrink-0" title="Calificación más baja">${minScore}</span>
                                    <div class="flex-1 min-w-0">
                                        <p class="font-bold text-red-900 text-xs truncate">${d.colegio}</p>
                                        <div class="flex flex-col mt-1 gap-1">
                                            <p class="text-[10px] text-red-700 truncate"><i class="fa-solid fa-chalkboard-user mr-1 opacity-70"></i> ${d.asistente || 'Anónimo'}</p>
                                            <p class="text-[10px] font-bold text-gray-700 truncate"><i class="fa-solid fa-user-tie mr-1 opacity-70"></i> Coach: ${d.coach}</p>
                                        </div>
                                    </div>
                                </div>
                                <div class="bg-white/70 p-2.5 rounded-lg border border-red-100/50 text-[11px] italic text-gray-800 shadow-inner">
                                    "${d.sugerencias || 'Sin comentarios registrados.'}"
                                </div>
                            </div>`;
                        } else {
                            detractoresHTML += `
                            <div class="p-4 bg-red-50 rounded-xl border border-red-100 flex flex-col gap-3 hover:bg-red-100 transition-colors">
                                <div class="flex items-center gap-3">
                                    <span class="w-8 h-8 flex items-center justify-center bg-red-600 text-white rounded-lg text-sm font-black shadow-sm shrink-0" title="Calificación más baja">${minScore}</span>
                                    <div class="flex-1 min-w-0">
                                        <p class="font-bold text-red-900 text-xs truncate">${d.colegio}</p>
                                        <p class="text-[9px] text-red-700 mt-0.5">${f}</p>
                                    </div>
                                </div>
                                <div class="bg-white/70 p-2.5 rounded-lg border border-red-100/50 text-[11px] italic text-gray-800 shadow-inner">
                                    "${d.sugerencias || 'Sin comentarios registrados.'}"
                                </div>
                            </div>`;
                        }
                    });
                    dList.innerHTML = detractoresHTML;
                }
            }
            this.renderRegistrosTable(true);
        } catch (err) {
            console.error("Error en updateDashboard (Datos corruptos en BD):", err);
        }
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

    renderRegistrosTable: function(resetPagination = true) {
        if (resetPagination) State.currentRendered = 0;

        this.populateRegistrosFilters();
        const fechaVal = document.getElementById('reg_filter_fecha')?.value; 
        const regVal = document.getElementById('reg_filter_regional')?.value;
        const colVal = document.getElementById('reg_filter_colegio')?.value; 
        const tallerVal = document.getElementById('reg_filter_taller')?.value;
        const coachVal = document.getElementById('reg_filter_coach')?.value;
        
        let data = State.encuestasData.map(d => { 
            const col = State.colegiosBD.find(c => (c.colegio || "").toUpperCase() === (d.colegio || "").toUpperCase()); 
            return { ...d, regional: col ? col.regional : 'Sin Regional' }; 
        });
        
        if (fechaVal) { const p = fechaVal.split('-'); const sd = `${parseInt(p[2])}/${parseInt(p[1])}/${p[0]}`; data = data.filter(d => { let f = ""; if (d.timestamp) { const o = new Date(d.timestamp); f = `${o.getDate()}/${o.getMonth() + 1}/${o.getFullYear()}`; } else if (d.fecha) f = String(d.fecha).split(',')[0].trim(); return f === sd || f === `${p[2]}/${p[1]}/${p[0]}`; }); }
        if (regVal) data = data.filter(d => d.regional === regVal); 
        if (colVal) data = data.filter(d => d.colegio === colVal);
        if (tallerVal) data = data.filter(d => d.numTaller === tallerVal); 
        if (coachVal && State.currentUserRole === 'admin') data = data.filter(d => d.coach === coachVal);
        if (State.currentUserRole === 'coach') data = data.filter(d => d.coach === State.loginUser.nombre);
        
        State.registrosFiltrados = data;

        const tBody = document.getElementById('tabla_registros');
        if(!tBody) return;
        
        if (resetPagination) tBody.innerHTML = '';
        const paginationContainer = document.getElementById('pagination_container');

        if (data.length === 0) { 
            tBody.innerHTML = `<tr><td colspan="9" class="px-6 py-8 text-center text-gray-400 italic">No hay registros para mostrar.</td></tr>`; 
            if(paginationContainer) paginationContainer.classList.add('hidden');
            return; 
        }

        const template = document.getElementById('row-template');
        if(!template) return;
        
        const nextBatch = data.slice(State.currentRendered, State.currentRendered + State.paginationLimit);

        nextBatch.forEach(d => {
            const clone = template.content.cloneNode(true);
            
            let sum = 0, count = 0;
            ['q6', 'q7', 'q8', 'q9'].forEach(q => { const s = parseFloat(d[q] || d[q?.toUpperCase()]); if(!isNaN(s)){ sum += s; count++; } });
            const avg = count > 0 ? (sum / count).toFixed(1) : '-';
            
            let f = "Fecha no válida"; 
            if (d.timestamp) { const o = new Date(d.timestamp); f = `${o.getDate().toString().padStart(2, '0')}/${(o.getMonth() + 1).toString().padStart(2, '0')}/${o.getFullYear()}`; } 
            else if (d.fecha) { f = String(d.fecha).split(',')[0].trim(); }

            clone.querySelector('.t-fecha').textContent = f;
            clone.querySelector('.t-colegio').textContent = d.colegio;
            clone.querySelector('.t-regional').textContent = d.regional;
            clone.querySelector('.t-taller').textContent = `${d.numTaller}: ${d.taller}`;
            clone.querySelector('.t-asistente').textContent = d.asistente || 'Anónimo';
            clone.querySelector('.t-perfil').textContent = d.perfil;
            clone.querySelector('.t-coach').textContent = d.coach;
            
            const badge = clone.querySelector('.t-promedio');
            badge.textContent = avg;
            if (avg >= 4.0) badge.className += ' text-green-700 bg-green-50';
            else if (avg >= 3.0) badge.className += ' text-yellow-700 bg-yellow-50';
            else badge.className += ' text-red-700 bg-red-50';

            clone.querySelector('.t-sugerencias').textContent = d.sugerencias || 'Sin comentarios';

            const btnEdit = clone.querySelector('.btn-edit');
            const btnDelete = clone.querySelector('.btn-delete');
            btnEdit.onclick = () => App.openEditRegistroModal(d.id);
            btnDelete.onclick = () => App.deleteRegistro(d.id);

            // SEGURIDAD EN DOM
            if(State.currentUserRole !== 'admin') {
                const colAsistente = clone.querySelector('.t-asistente');
                if(colAsistente) colAsistente.style.display = 'none';
                
                const colAcciones = clone.querySelector('.t-acciones');
                if(colAcciones) colAcciones.style.display = 'none';
            }

            tBody.appendChild(clone);
        });

        State.currentRendered += nextBatch.length;
        const remaining = data.length - State.currentRendered;

        if(paginationContainer) {
            if (remaining > 0) {
                paginationContainer.classList.remove('hidden');
                document.getElementById('count_restantes').textContent = remaining;
            } else {
                paginationContainer.classList.add('hidden');
            }
        }
    },

    loadMoreRegistros: function() {
        this.renderRegistrosTable(false);
    },

    // CRUD SEGURO (SOLO ADMIN)
    deleteRegistro: async function(id) {
        if(State.currentUserRole !== 'admin') return alert("Acceso denegado: Solo los administradores pueden eliminar registros.");
        
        if(!confirm("⚠️ ATENCIÓN: ¿Estás seguro que deseas ELIMINAR este registro de la base de datos?\nEsta acción no se puede deshacer.")) return;
        if(!confirm("Por favor, confirma de nuevo la eliminación.")) return;
        
        try {
            await deleteDoc(doc(db, "encuestas", id));
            State.encuestasData = State.encuestasData.filter(d => d.id !== id);
            this.updateDashboard(); 
            alert("Registro eliminado exitosamente.");
        } catch(e) {
            alert("Error al eliminar el registro.");
            console.error(e);
        }
    },

    openEditRegistroModal: function(id) {
        if(State.currentUserRole !== 'admin') return alert("Acceso denegado: Solo los administradores pueden editar registros.");

        const registro = State.encuestasData.find(d => d.id === id);
        if(!registro) return;

        let coachOptions = '<option value="">Seleccione...</option>'; 
        [...new Set(State.coachesAuth.map(c => c.nombre))].sort().forEach(c => coachOptions += `<option value="${c}" ${registro.coach === c ? 'selected' : ''}>${c}</option>`);

        let colOptions = '<option value="">Seleccione...</option>'; 
        [...new Set(State.colegiosBD.map(c => c.colegio))].sort().forEach(c => colOptions += `<option value="${c}" ${registro.colegio === c ? 'selected' : ''}>${c}</option>`);

        this.showModal("Editar Registro de Encuesta", `
            <div class="space-y-4">
                <p class="text-xs text-red-500 mb-4 bg-red-50 p-2 rounded">Cualquier cambio aquí afectará directamente las estadísticas del dashboard.</p>
                <div class="grid grid-cols-2 gap-4">
                    <div><label class="text-xs font-bold text-gray-500">Colegio</label>
                    <select id="edit_reg_colegio" class="w-full border rounded-xl px-3 py-2 text-sm">${colOptions}</select></div>
                    <div><label class="text-xs font-bold text-gray-500">Coach Asignado</label>
                    <select id="edit_reg_coach" class="w-full border rounded-xl px-3 py-2 text-sm">${coachOptions}</select></div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div><label class="text-xs font-bold text-gray-500">Perfil</label>
                    <select id="edit_reg_perfil" class="w-full border rounded-xl px-3 py-2 text-sm">
                        <option value="Docente" ${registro.perfil === 'Docente' ? 'selected' : ''}>Docente</option>
                        <option value="Directivo" ${registro.perfil === 'Directivo' ? 'selected' : ''}>Directivo</option>
                    </select></div>
                    <div><label class="text-xs font-bold text-gray-500">Asistente</label>
                    <input type="text" id="edit_reg_asistente" value="${registro.asistente || ''}" class="w-full border rounded-xl px-3 py-2 text-sm"></div>
                </div>
                <div class="grid grid-cols-4 gap-2 border-t pt-4">
                    <div><label class="text-[10px] font-bold text-gray-500">Q6 (Conoc.)</label>
                    <input type="number" id="edit_reg_q6" value="${registro.q6 || ''}" max="5" min="1" class="w-full border rounded-lg px-2 py-1 text-sm text-center"></div>
                    <div><label class="text-[10px] font-bold text-gray-500">Q7 (Utilidad)</label>
                    <input type="number" id="edit_reg_q7" value="${registro.q7 || ''}" max="5" min="1" class="w-full border rounded-lg px-2 py-1 text-sm text-center"></div>
                    <div><label class="text-[10px] font-bold text-gray-500">Q8 (Dinam.)</label>
                    <input type="number" id="edit_reg_q8" value="${registro.q8 || ''}" max="5" min="1" class="w-full border rounded-lg px-2 py-1 text-sm text-center"></div>
                    <div><label class="text-[10px] font-bold text-gray-500">Q9 (Recurso)</label>
                    <input type="number" id="edit_reg_q9" value="${registro.q9 || ''}" max="5" min="1" class="w-full border rounded-lg px-2 py-1 text-sm text-center"></div>
                </div>
            </div>
        `, `<button onclick="App.hideModal()" class="px-6 py-2 bg-gray-200 rounded-xl font-bold">Cancelar</button>
            <button onclick="App.saveEditRegistro('${id}')" class="px-6 py-2 bg-[#FF5A00] text-white rounded-xl font-bold shadow-md">Guardar Cambios</button>`);
    },

    saveEditRegistro: async function(id) {
        if(State.currentUserRole !== 'admin') return alert("Acceso denegado.");

        const btn = event.target;
        btn.disabled = true; btn.innerText = "Guardando...";

        const dataActualizada = {
            colegio: document.getElementById('edit_reg_colegio').value,
            coach: document.getElementById('edit_reg_coach').value,
            perfil: document.getElementById('edit_reg_perfil').value,
            asistente: document.getElementById('edit_reg_asistente').value,
            q6: parseFloat(document.getElementById('edit_reg_q6').value) || 0,
            q7: parseFloat(document.getElementById('edit_reg_q7').value) || 0,
            q8: parseFloat(document.getElementById('edit_reg_q8').value) || 0,
            q9: parseFloat(document.getElementById('edit_reg_q9').value) || 0,
        };

        try {
            await setDoc(doc(db, "encuestas", id), dataActualizada, { merge: true });
            const index = State.encuestasData.findIndex(d => d.id === id);
            if(index !== -1) State.encuestasData[index] = { ...State.encuestasData[index], ...dataActualizada };
            
            this.hideModal();
            this.updateDashboard();
            alert("Cambios guardados con éxito.");
        } catch (error) {
            alert("Hubo un error al guardar.");
            console.error(error);
            btn.disabled = false; btn.innerText = "Guardar Cambios";
        }
    },

    exportToExcel: function() {
        const list = State.registrosFiltrados && State.registrosFiltrados.length > 0 ? State.registrosFiltrados : State.filteredEncuestas;
        if (!list || list.length === 0) { alert("No hay datos para exportar."); return; }
        const data = list.map(d => {
            let f = "Sin Fecha"; if (d.timestamp) { const o = new Date(d.timestamp); f = `${o.getDate()}/${(o.getMonth() + 1)}/${o.getFullYear()}`; } else if (d.fecha) f = String(d.fecha).split(',')[0].trim();
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
