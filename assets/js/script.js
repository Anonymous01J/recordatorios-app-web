// ==================== CONFIGURACIÓN ====================
const ONE_SIGNAL_APP_ID = 'e9ec8803-b4a6-4235-b1a3-8052ae76dc04';

// Definición de las dos notificaciones base
const NOTIFICACIONES = {
    suplemento: {
        id: 'suplemento',
        titulo: "💊 ¿Ya te tomaste tu suplemento?",
        mensaje: "Si no lo has hecho, hazlo. Que no te hice esto para que lo ignores 🙃",
        horaInicio: 12,
        horaFin: 21,
        intervalo: 3,
        activa: true,
        prioridad: 'high',
        icono: "💊",
        ultimaNotificacion: null,
        tipo: 'periodico',
        esBase: true
    },
    parche: {
        id: 'parche',
        titulo: "🏴‍☠️ ¿Te pusiste tu parche hoy?",
        mensaje: "Si no lo has hecho, es tu momento de hacer Cosplay de Garfio 🪝",
        horaUnica: 21,
        activa: true,
        prioridad: 'high',
        icono: "🪝",
        ultimaNotificacion: null,
        tipo: 'diario',
        notificadoHoy: false,
        esBase: true
    }
};

// Estado de la aplicación
let appState = {
    suscrito: false,
    dndActivo: false,
    dndExpira: null,
    notificacionesHoy: {
        suplemento: 0,
        parche: 0
    },
    historial: [],
    fechaUltimoParche: null,
    notificacionesPersonalizadas: []
};

// ==================== INICIALIZACIÓN ====================
document.addEventListener('DOMContentLoaded', async () => {
    cargarEstadoGuardado();
    inicializarOneSignal();
    escucharMensajesServiceWorker();
    await cargarHistorialDesdeDB(); // ← lee IndexedDB antes de renderizar
    renderizarUI();
    iniciarVerificadorNotificaciones();
    inicializarModal();
});

// ==================== LISTENER SERVICE WORKER ====================
function escucharMensajesServiceWorker() {
    if (!navigator.serviceWorker) return;

    navigator.serviceWorker.addEventListener('message', event => {
        const { type, tipo, item } = event.data || {};

        if (type === 'NUEVA_NOTIF' && item) {
            appState.historial.unshift(item);
            if (appState.historial.length > 50) appState.historial.pop();
            renderizarHistorial();
            renderizarNotificaciones();
        }

        if (type === 'MARK_DONE') {
            // Buscar el item más reciente del mismo tipo y marcarlo
            const idTipo = tipo || 'suplemento';
            const target = appState.historial.find(n => n.idTipo === idTipo && !n.completado);
            if (target) {
                target.completado = true;
                guardarItemEnDB(target);
                renderizarHistorial();
                renderizarNotificaciones();
            }
            showMessage('✅ ¡Marcado como hecho!', 'success');
        }

        if (type === 'INCREMENTAR_CONTADOR' && event.data.idTipo) {
            const id = event.data.idTipo;
            if (appState.notificacionesHoy[id] !== undefined) {
                appState.notificacionesHoy[id]++;
            } else {
                appState.notificacionesHoy[id] = 1;
            }
            guardarEstado();
            actualizarContadores();
        }
    });
}

// ==================== INDEXEDDB (frontend) ====================
function abrirDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('recordatoriosDB', 1);
        req.onupgradeneeded = e => {
            e.target.result.createObjectStore('historial', { keyPath: 'id' });
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror   = e => reject(e.target.error);
    });
}

async function cargarHistorialDesdeDB() {
    try {
        const db = await abrirDB();
        const items = await new Promise((resolve, reject) => {
            const tx    = db.transaction('historial', 'readonly');
            const req   = tx.objectStore('historial').getAll();
            req.onsuccess = e => resolve(e.target.result);
            req.onerror   = e => reject(e.target.error);
        });
        // Ordenar por timestamp desc y tomar los últimos 50
        items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        appState.historial = items.slice(0, 50);
    } catch(e) {
        console.warn('IndexedDB no disponible, usando localStorage:', e);
        const guardado = localStorage.getItem('historialNotificaciones');
        if (guardado) appState.historial = JSON.parse(guardado);
    }
}

async function guardarItemEnDB(item) {
    try {
        const db = await abrirDB();
        await new Promise((resolve, reject) => {
            const tx    = db.transaction('historial', 'readwrite');
            tx.objectStore('historial').put(item);
            tx.oncomplete = resolve;
            tx.onerror    = e => reject(e.target.error);
        });
    } catch(e) {
        // Fallback a localStorage
        localStorage.setItem('historialNotificaciones', JSON.stringify(appState.historial));
    }
}

async function marcarComoCompletadoDB(tipo) {
    const item = appState.historial.find(n => n.idTipo === tipo && !n.completado);
    if (!item) return;
    item.completado = true;
    await guardarItemEnDB(item);
    renderizarHistorial();
}

function cargarEstadoGuardado() {
    const guardado = localStorage.getItem('appState');
    if (guardado) {
        appState = JSON.parse(guardado);
    }

    const hoy = new Date().toDateString();
    if (appState.fechaUltimoParche !== hoy) {
        NOTIFICACIONES.parche.notificadoHoy = false;
        appState.fechaUltimoParche = hoy;
    }

    // Resetear contadores si es un nuevo día
    if (appState.fechaContador !== hoy) {
        appState.notificacionesHoy = { suplemento: 0, parche: 0 };
        appState.fechaContador = hoy;
    }

    if (!appState.notificacionesPersonalizadas) {
        appState.notificacionesPersonalizadas = [];
    }

    // Resetear notificadoHoy de personalizadas si es nuevo día
    appState.notificacionesPersonalizadas.forEach(n => {
        if (n.tipo === 'diario' && n.fechaUltimaNotif !== hoy) {
            n.notificadoHoy = false;
        }
    });

    // El historial se carga por separado desde IndexedDB en cargarHistorialDesdeDB()

    // Restaurar estado activa de notificaciones base
    if (appState.notificacionesBaseActiva) {
        Object.keys(appState.notificacionesBaseActiva).forEach(id => {
            if (NOTIFICACIONES[id]) {
                NOTIFICACIONES[id].activa = appState.notificacionesBaseActiva[id];
            }
        });
    }
}

function guardarEstado() {
    // Persistir también el estado activa de las notificaciones base
    appState.notificacionesBaseActiva = {
        suplemento: NOTIFICACIONES.suplemento.activa,
        parche:     NOTIFICACIONES.parche.activa
    };
    localStorage.setItem('appState', JSON.stringify(appState));
}

// ==================== ONE SIGNAL ====================
function inicializarOneSignal() {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    OneSignalDeferred.push(async function(OneSignal) {
        await OneSignal.init({
            appId: ONE_SIGNAL_APP_ID,
            notifyButton: { enable: false },
            autoResubscribe: true,
            welcomeNotification: {
                title: "💊 ¡Notificaciones activadas!",
                message: "Te recordaré tu suplemento y parche cada día 😉"
            }
        });

        // Fallback: si OneSignal captura el clic antes que el SW
        OneSignal.Notifications.addEventListener("click", (event) => {
            const actionId = event.result?.actionId;
            const tipo = event.notification?.data?.tipo || 'suplemento';

            if (actionId === 'done') {
                marcarComoCompletado(tipo);
                showMessage('✅ ¡Marcado como hecho!', 'success');
                renderizarUI();
            }
            // 'snooze' lo maneja el SW directamente
        });

        await verificarSuscripcion();

        // Guardar Player ID para usarlo al programar notificaciones personalizadas
        try {
            const pid = OneSignal.User.PushSubscription.id;
            if (pid) {
                appState.playerId = pid;
                guardarEstado();
            }
        } catch(e) { console.warn('Player ID error:', e); }
    });
}

function configurarListeners() {}

async function getPlayerId() {
    try {
        const OneSignal = window.OneSignal;
        if (OneSignal) {
            const pid = OneSignal.User.PushSubscription.id;
            if (pid) {
                appState.playerId = pid;
                guardarEstado();
                return pid;
            }
        }
    } catch(e) {}
    return appState.playerId || null;
}

async function verificarSuscripcion() {
    const permisoNavegador = Notification.permission === 'granted';
    if (!permisoNavegador) {
        appState.suscrito = false;
        guardarEstado();
        renderizarEstado();
        return;
    }
    try {
        const OneSignal = window.OneSignal;
        const optedIn = OneSignal ? OneSignal.User.PushSubscription.optedIn : false;
        appState.suscrito = permisoNavegador && (optedIn === true || optedIn === undefined);
    } catch(e) {
        appState.suscrito = permisoNavegador;
    }
    guardarEstado();
    renderizarEstado();
}

// ==================== SUSCRIPCIÓN ====================
window.suscribir = async function() {
    const OneSignal = window.OneSignal;
    if (OneSignal) {
        await OneSignal.Notifications.requestPermission();
        setTimeout(async () => {
            await verificarSuscripcion();
            // Inicializar tags con el estado actual de los switches y DND
            try {
                Object.keys(NOTIFICACIONES).forEach(id => {
                    OneSignal.User.addTag(id, NOTIFICACIONES[id].activa ? '1' : '0');
                });
                OneSignal.User.addTag('dnd', appState.dndActivo ? '1' : '0');
            } catch(e) { console.warn('OneSignal tag init error:', e); }
        }, 1500);
    }
};

window.desuscribir = async function() {
    const OneSignal = window.OneSignal;
    if (OneSignal) {
        await OneSignal.User.PushSubscription.optOut();
    }
    appState.suscrito = false;
    guardarEstado();
    renderizarEstado();
    showMessage('🔕 Notificaciones desactivadas', 'info');
};

// ==================== VERIFICADOR ====================
function iniciarVerificadorNotificaciones() {
    setInterval(verificarNotificaciones, 60000);
    verificarNotificaciones();
}

function verificarNotificaciones() {
    if (!appState.suscrito || appState.dndActivo) return;

    const ahora = new Date();
    const horaActual = ahora.getHours();
    const minutoActual = ahora.getMinutes();

    // Suplemento (cada 3h)
    const suplemento = NOTIFICACIONES.suplemento;
    if (suplemento.activa) {
        if (horaActual >= suplemento.horaInicio && horaActual <= suplemento.horaFin) {
            const horasDesdeInicio = horaActual - suplemento.horaInicio;
            if (horasDesdeInicio % suplemento.intervalo === 0 && minutoActual === 0) {
                const ultimaHora = suplemento.ultimaNotificacion ? new Date(suplemento.ultimaNotificacion).getHours() : -1;
                if (ultimaHora !== horaActual) {
                    enviarNotificacion(suplemento);
                }
            }
        }
    }

    // Parche (9pm)
    const parche = NOTIFICACIONES.parche;
    if (parche.activa && !parche.notificadoHoy) {
        if (horaActual === parche.horaUnica && minutoActual === 0) {
            enviarNotificacion(parche);
            parche.notificadoHoy = true;
            appState.fechaUltimoParche = new Date().toDateString();
            guardarEstado();
        }
    }

    // Notificaciones personalizadas
    const hoy = new Date().toDateString();
    appState.notificacionesPersonalizadas.forEach(notif => {
        if (!notif.activa) return;

        if (notif.tipo === 'diario') {
            if (!notif.notificadoHoy && horaActual === notif.hora && minutoActual === 0) {
                enviarNotificacionPersonalizada(notif);
                notif.notificadoHoy = true;
                notif.fechaUltimaNotif = hoy;
                guardarEstado();
            }
        } else if (notif.tipo === 'periodico') {
            const horasDesde = horaActual - (notif.horaInicio || 8);
            if (horaActual >= (notif.horaInicio || 8) &&
                horaActual <= (notif.horaFin || 22) &&
                horasDesde % notif.intervalo === 0 &&
                minutoActual === 0) {
                const ultimaHora = notif.ultimaNotificacion ? new Date(notif.ultimaNotificacion).getHours() : -1;
                if (ultimaHora !== horaActual) {
                    enviarNotificacionPersonalizada(notif);
                }
            }
        } else if (notif.tipo === 'unica') {
            if (!notif.enviada && horaActual === notif.hora && minutoActual === 0) {
                enviarNotificacionPersonalizada(notif);
                notif.enviada = true;
                guardarEstado();
            }
        }
    });
}

async function enviarNotificacion(notificacion) {
    if (appState.dndActivo) {
        agregarAlHistorial({ ...notificacion, omitida: true, razon: 'Modo No Molestar' });
        return;
    }

    const ahora = new Date();
    const horaStr = formatHour(ahora.getHours());
    const fechaStr = ahora.toLocaleDateString();

    // Botones según tipo: suplemento tiene snooze, los demás solo hecho
    const acciones = notificacion.id === 'suplemento'
        ? [
            { action: 'done',   title: '✅ ¡Hecho!' },
            { action: 'snooze', title: '⏰ Recordarme luego' }
          ]
        : [
            { action: 'done', title: '✅ ¡Hecho!' }
          ];

    const options = {
        title: notificacion.titulo,
        body: notificacion.mensaje,
        icon: window.location.origin + '/icon-192x192.png',
        badge: window.location.origin + '/badge-72x72.png',
        data: { tipo: notificacion.id, hora: ahora.getHours(), fecha: fechaStr },
        requireInteraction: true,
        vibrate: [300, 200, 300, 200, 300],
        actions: acciones
    };

    if (Notification.permission === 'granted') {
        new Notification(options.title, options);
    }

    notificacion.ultimaNotificacion = ahora.toISOString();
    appState.notificacionesHoy[notificacion.id]++;

    agregarAlHistorial({
        id: notificacion.id,
        titulo: notificacion.titulo,
        mensaje: notificacion.mensaje,
        icono: notificacion.icono,
        hora: horaStr,
        fecha: fechaStr,
        timestamp: ahora.toISOString(),
        leida: false,
        completado: false
    });

    actualizarContadores();
    guardarEstado();
}

async function enviarNotificacionPersonalizada(notif) {
    if (appState.dndActivo) return;

    const ahora = new Date();
    const horaStr = formatHour(ahora.getHours());
    const fechaStr = ahora.toLocaleDateString();

    const options = {
        title: notif.titulo,
        body: notif.mensaje,
        icon: window.location.origin + '/icon-192x192.png',
        data: { tipo: notif.id, hora: ahora.getHours() },
        requireInteraction: true,
        vibrate: [200, 100, 200],
        // Personalizadas: solo hecho
        actions: [
            { action: 'done', title: '✅ ¡Hecho!' }
        ]
    };

    if (Notification.permission === 'granted') {
        new Notification(options.title, options);
    }

    notif.ultimaNotificacion = ahora.toISOString();

    agregarAlHistorial({
        id: notif.id,
        titulo: notif.titulo,
        mensaje: notif.mensaje,
        icono: notif.icono,
        hora: horaStr,
        fecha: fechaStr,
        timestamp: ahora.toISOString(),
        leida: false,
        completado: false
    });

    guardarEstado();
}

function programarRecordatorio(tipo, minutos) {
    setTimeout(() => {
        const notif = NOTIFICACIONES[tipo] || appState.notificacionesPersonalizadas.find(n => n.id === tipo);
        if (notif && notif.activa) {
            tipo in NOTIFICACIONES ? enviarNotificacion(notif) : enviarNotificacionPersonalizada(notif);
        }
    }, minutos * 60 * 1000);
}

function marcarComoCompletado(tipo) {
    // Marcar en el historial
    const notif = appState.historial.find(n => n.id === tipo && !n.completado);
    if (notif) {
        notif.completado = true;
        localStorage.setItem('historialNotificaciones', JSON.stringify(appState.historial));
        renderizarHistorial();
    }

    // Actualizar badge de contador visual
    guardarEstado();
}



// ==================== MODO NO MOLESTAR ====================
function setDndTag(activo) {
    try {
        const OneSignal = window.OneSignal;
        if (OneSignal && OneSignal.User && OneSignal.User.addTag) {
            OneSignal.User.addTag('dnd', activo ? '1' : '0');
        }
    } catch(e) { console.warn('OneSignal dnd tag error:', e); }
}

window.activarNoMolestar = function() {
    const finDelDia = new Date();
    finDelDia.setHours(23, 59, 59, 999);
    appState.dndActivo = true;
    appState.dndExpira = finDelDia.toISOString();
    setDndTag(true);
    guardarEstado();
    renderizarUI();
    showMessage('🔕 Modo No Molestar activo hasta medianoche', 'info');
};

window.desactivarNoMolestar = function() {
    appState.dndActivo = false;
    appState.dndExpira = null;
    setDndTag(false);
    guardarEstado();
    renderizarUI();
    showMessage('🔔 Modo No Molestar desactivado', 'success');
};

// ==================== MODAL NUEVA NOTIFICACIÓN ====================
function inicializarModal() {
    const modal = document.getElementById('modalNueva');
    const overlay = document.getElementById('modalOverlay');

    document.getElementById('tipoRepeticion').addEventListener('change', function() {
        document.getElementById('opcionesPeriodico').style.display =
            this.value === 'periodico' ? 'block' : 'none';
        document.getElementById('opcionesHora').style.display =
            this.value !== 'periodico' ? 'block' : 'none';
    });

    overlay.addEventListener('click', cerrarModal);
}

window.abrirModal = function() {
    document.getElementById('modalNueva').classList.add('activo');
    document.getElementById('modalOverlay').classList.add('activo');
    document.body.style.overflow = 'hidden';
};

window.cerrarModal = function() {
    document.getElementById('modalNueva').classList.remove('activo');
    document.getElementById('modalOverlay').classList.remove('activo');
    document.body.style.overflow = '';
    limpiarFormulario();
};

function limpiarFormulario() {
    document.getElementById('formNueva').reset();
    document.getElementById('opcionesPeriodico').style.display = 'none';
    document.getElementById('opcionesHora').style.display = 'block';
}

window.guardarNotificacionPersonalizada = async function() {
    const titulo = document.getElementById('nuevaTitulo').value.trim();
    const mensaje = document.getElementById('nuevaMensaje').value.trim();
    const icono   = document.getElementById('nuevoIcono').value.trim() || '🔔';
    const tipo    = document.getElementById('tipoRepeticion').value;

    if (!titulo || !mensaje) {
        showMessage('❌ Título y mensaje son obligatorios', 'error');
        return;
    }

    const nuevaNotif = {
        id:                 'custom_' + Date.now(),
        titulo:             icono + ' ' + titulo,
        mensaje,
        icono,
        activa:             true,
        tipo,
        notificadoHoy:      false,
        ultimaNotificacion: null,
        esBase:             false
    };

    if (tipo === 'periodico') {
        nuevaNotif.horaInicio = parseInt(document.getElementById('horaInicioPeriodico').value) || 8;
        nuevaNotif.horaFin    = parseInt(document.getElementById('horaFinPeriodico').value)    || 22;
        nuevaNotif.intervalo  = parseInt(document.getElementById('intervaloPeriodico').value)  || 2;
    } else {
        nuevaNotif.hora = parseInt(document.getElementById('horaUnica').value) || 9;
    }

    appState.notificacionesPersonalizadas.push(nuevaNotif);
    guardarEstado();
    renderizarNotificaciones();
    cerrarModal();

    // Programar en OneSignal via backend
    const playerId = await getPlayerId();
    if (!playerId) {
        showMessage('✅ Recordatorio guardado (activo solo con app abierta — activa notificaciones para 2do plano)', 'info');
        return;
    }

    try {
        showMessage('⏳ Programando recordatorio...', 'info');
        const res = await fetch('https://recordatorios-backend.vercel.app/api/schedule', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ playerId, notif: nuevaNotif })
        });
        const data = await res.json();
        if (data.ok) {
            showMessage('✅ Recordatorio creado y programado', 'success');
        } else {
            console.error('schedule error:', data);
            showMessage('✅ Guardado localmente (error al programar en 2do plano)', 'info');
        }
    } catch(e) {
        console.error('schedule fetch error:', e);
        showMessage('✅ Guardado localmente (sin conexión al backend)', 'info');
    }
};

window.eliminarNotificacionPersonalizada = function(id) {
    appState.notificacionesPersonalizadas = appState.notificacionesPersonalizadas.filter(n => n.id !== id);
    guardarEstado();
    renderizarNotificaciones();
    showMessage('🗑️ Recordatorio eliminado', 'info');
};

// ==================== UI ====================
function renderizarUI() {
    renderizarEstado();
    renderizarNotificaciones();
    renderizarControlesNoMolestar();
    renderizarHistorial();
    renderizarProximasNotificaciones();
}

function renderizarEstado() {
    const indicator = document.getElementById('statusIndicator');
    const text = document.getElementById('statusText');
    const subscribeBtn = document.getElementById('subscribeBtn');
    const unsubscribeBtn = document.getElementById('unsubscribeBtn');

    if (appState.suscrito) {
        indicator.className = 'status-indicator subscribed';
        text.textContent = '✅ Suscrito - Recibirás recordatorios';
        subscribeBtn.style.display = 'none';
        unsubscribeBtn.style.display = 'block';
    } else {
        indicator.className = 'status-indicator unsubscribed';
        text.textContent = '❌ No suscrito';
        subscribeBtn.style.display = 'block';
        unsubscribeBtn.style.display = 'none';
    }
}

function renderizarNotificaciones() {
    const container = document.getElementById('notificacionesContainer');
    if (!container) return;

    let html = `<div class="notificaciones-grid">
        <!-- Suplemento -->
        <div class="notificacion-card ${NOTIFICACIONES.suplemento.activa ? 'activa' : ''}">
            <div class="notif-header">
                <span class="notif-icon">💊</span>
                <span class="notif-title">Suplemento</span>
                <label class="switch">
                    <input type="checkbox"
                           ${NOTIFICACIONES.suplemento.activa ? 'checked' : ''}
                           onchange="toggleNotificacion('suplemento')">
                    <span class="slider"></span>
                </label>
            </div>
            <div class="notif-schedule">📅 12:00 PM · 3:00 PM · 6:00 PM · 9:00 PM</div>
            <div class="notif-stats">
                ${appState.historial.some(h => h.idTipo === 'suplemento' && h.completado && h.timestamp && h.timestamp.startsWith(new Date().toISOString().slice(0,10))) ?
                    '<span class="badge done">✅ Completado</span>' :
                    '<span class="badge pending">⏳ Pendiente</span>'}
            </div>
        </div>
        <!-- Parche -->
        <div class="notificacion-card ${NOTIFICACIONES.parche.activa ? 'activa' : ''}">
            <div class="notif-header">
                <span class="notif-icon">🪝</span>
                <span class="notif-title">Parche de Garfio</span>
                <label class="switch">
                    <input type="checkbox"
                           ${NOTIFICACIONES.parche.activa ? 'checked' : ''}
                           onchange="toggleNotificacion('parche')">
                    <span class="slider"></span>
                </label>
            </div>
            <div class="notif-schedule">📅 9:00 PM — una vez al día</div>
            <div class="notif-stats">
                ${appState.historial.some(h => h.idTipo === 'parche' && h.completado && h.timestamp && h.timestamp.startsWith(new Date().toISOString().slice(0,10))) ?
                    '<span class="badge done">✅ Completado</span>' :
                    '<span class="badge pending">⏳ Pendiente</span>'}
            </div>
        </div>`;

    appState.notificacionesPersonalizadas.forEach(notif => {
        const scheduleText = notif.tipo === 'periodico'
            ? `📅 Cada ${notif.intervalo}h · ${formatHour(notif.horaInicio)} a ${formatHour(notif.horaFin)}`
            : notif.tipo === 'diario'
            ? `📅 Diario a las ${formatHour(notif.hora)}`
            : `📅 Una vez a las ${formatHour(notif.hora)}`;

        html += `
        <div class="notificacion-card ${notif.activa ? 'activa' : ''} custom">
            <div class="notif-header">
                <span class="notif-icon">${notif.icono}</span>
                <span class="notif-title">${notif.titulo.replace(notif.icono + ' ', '')}</span>
                <label class="switch">
                    <input type="checkbox"
                           ${notif.activa ? 'checked' : ''}
                           onchange="toggleNotificacionPersonalizada('${notif.id}')">
                    <span class="slider"></span>
                </label>
            </div>
            <div class="notif-schedule">${scheduleText}</div>
            <div class="notif-stats">
                <span class="badge pending">${notif.tipo === 'periodico' ? '🔄 Periódico' : notif.tipo === 'diario' ? '📆 Diario' : '1️⃣ Una vez'}</span>
                <button class="btn-delete" onclick="eliminarNotificacionPersonalizada('${notif.id}')">🗑️</button>
            </div>
        </div>`;
    });

    html += `</div>`;
    container.innerHTML = html;
}

function renderizarControlesNoMolestar() {
    const container = document.getElementById('dndControls');
    if (!container) return;

    if (appState.dndActivo) {
        const expira = new Date(appState.dndExpira);
        container.innerHTML = `
            <div class="dnd-banner">
                <span>🔕 No Molestar activo hasta ${expira.toLocaleTimeString()}</span>
                <button onclick="desactivarNoMolestar()" class="btn btn-outline">❌ Desactivar</button>
            </div>`;
    } else {
        container.innerHTML = `
            <div class="dnd-controls">
                <h3>🔕 ¿Quieres desconectar por hoy?</h3>
                <p>Silencia todos los recordatorios hasta mañana</p>
                <button onclick="activarNoMolestar()" class="btn-dnd">🌙 No molestar hasta mañana</button>
            </div>`;
    }
}

function renderizarProximasNotificaciones() {
    const container = document.getElementById('proximasContainer');
    if (!container) return;

    const ahora = new Date();
    const horaActual = ahora.getHours();
    const proximas = [];

    const suplemento = NOTIFICACIONES.suplemento;
    if (suplemento.activa) {
        for (let h = suplemento.horaInicio; h <= suplemento.horaFin; h += suplemento.intervalo) {
            if (h > horaActual) {
                proximas.push({ icono: suplemento.icono, titulo: 'Suplemento', horaFormateada: formatHour(h), tipo: 'Cada 3h' });
                break;
            }
        }
    }

    const parche = NOTIFICACIONES.parche;
    if (parche.activa && !parche.notificadoHoy && parche.horaUnica > horaActual) {
        proximas.push({ icono: parche.icono, titulo: 'Parche de Garfio', horaFormateada: formatHour(parche.horaUnica), tipo: 'Una vez' });
    }

    appState.notificacionesPersonalizadas.forEach(notif => {
        if (!notif.activa) return;
        if (notif.tipo === 'diario' && !notif.notificadoHoy && notif.hora > horaActual) {
            proximas.push({ icono: notif.icono, titulo: notif.titulo.replace(notif.icono + ' ', ''), horaFormateada: formatHour(notif.hora), tipo: 'Diario' });
        } else if (notif.tipo === 'unica' && !notif.enviada && notif.hora > horaActual) {
            proximas.push({ icono: notif.icono, titulo: notif.titulo.replace(notif.icono + ' ', ''), horaFormateada: formatHour(notif.hora), tipo: 'Una vez' });
        }
    });

    if (proximas.length === 0) {
        container.innerHTML = `<p class="text-muted">No hay más recordatorios por hoy</p>`;
        return;
    }

    container.innerHTML = proximas.map(notif => `
        <div class="proxima-item">
            <span class="proxima-icon">${notif.icono}</span>
            <div class="proxima-info">
                <span class="proxima-titulo">${notif.titulo}</span>
                <span class="proxima-tipo">${notif.tipo}</span>
            </div>
            <span class="proxima-hora">${notif.horaFormateada}</span>
        </div>
    `).join('');
}

function renderizarHistorial() {
    const container = document.getElementById('historialContainer');
    if (!container) return;

    if (appState.historial.length === 0) {
        container.innerHTML = '<p class="empty">Aún no hay notificaciones</p>';
        return;
    }

    container.innerHTML = appState.historial.slice(0, 10).map(item => `
        <div class="historial-item ${item.omitida ? 'omitida' : ''} ${item.completado ? 'completado' : ''}">
            <div class="historial-icon">${item.icono || '🔔'}</div>
            <div class="historial-content">
                <div class="historial-header">
                    <span class="historial-title">${item.titulo}</span>
                    <span class="historial-time">${item.hora}</span>
                </div>
                <div class="historial-message">${item.mensaje}</div>
                ${item.omitida ? '<span class="badge omitted">🔇 Omitida</span>' : ''}
                ${item.completado ? '<span class="badge done">✅ Completado</span>' : '<span class="badge pending">⏳ Pendiente</span>'}
            </div>
        </div>
    `).join('');
}

function actualizarContadores() { /* eliminado */ }

// ==================== TOGGLES ====================
window.toggleNotificacion = function(id) {
    if (NOTIFICACIONES[id]) {
        NOTIFICACIONES[id].activa = !NOTIFICACIONES[id].activa;
        const activa = NOTIFICACIONES[id].activa;

        // Actualizar tag en OneSignal para que el backend filtre correctamente
        try {
            const OneSignal = window.OneSignal;
            if (OneSignal && OneSignal.User && OneSignal.User.addTag) {
                OneSignal.User.addTag(id, activa ? '1' : '0');
            }
        } catch(e) { console.warn('OneSignal tag error:', e); }

        guardarEstado();
        renderizarNotificaciones();
        renderizarProximasNotificaciones();
        const nombre = id === 'suplemento' ? 'del suplemento' : 'del parche';
        showMessage(activa ? `✅ Recordatorio ${nombre} activado` : `❌ Recordatorio ${nombre} desactivado`, 'info');
    }
};

window.toggleNotificacionPersonalizada = function(id) {
    const notif = appState.notificacionesPersonalizadas.find(n => n.id === id);
    if (notif) {
        notif.activa = !notif.activa;
        guardarEstado();
        renderizarNotificaciones();
        showMessage(notif.activa ? '✅ Recordatorio activado' : '❌ Recordatorio desactivado', 'info');
    }
};

// ==================== HISTORIAL ====================
async function agregarAlHistorial(item) {
    const entrada = { ...item, id: item.id || Date.now(), idTipo: item.id };
    appState.historial.unshift(entrada);
    if (appState.historial.length > 50) appState.historial.pop();
    await guardarItemEnDB(entrada);
    renderizarHistorial();
}

function marcarComoCompletado(tipo) {
    marcarComoCompletadoDB(tipo);
}

// ==================== UTILIDADES ====================
function formatHour(hour) {
    if (hour === 0 || hour === 24) return '12:00 AM';
    if (hour === 12) return '12:00 PM';
    return hour > 12 ? `${hour-12}:00 PM` : `${hour}:00 AM`;
}

function showMessage(text, type) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message message-${type}`;
    msgDiv.textContent = text;
    document.body.appendChild(msgDiv);
    setTimeout(() => msgDiv.remove(), 3000);
}