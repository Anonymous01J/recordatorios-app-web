// ==================== CONFIGURACIÓN ====================
const ONE_SIGNAL_APP_ID = '6b37a1cf-ee9d-4941-8ca0-eb7bef3fbc75';

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
    renderizarUI();
    iniciarVerificadorNotificaciones();
    inicializarModal();
});

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

    if (!appState.notificacionesPersonalizadas) {
        appState.notificacionesPersonalizadas = [];
    }

    // Resetear notificadoHoy de personalizadas si es nuevo día
    appState.notificacionesPersonalizadas.forEach(n => {
        if (n.tipo === 'diario' && n.fechaUltimaNotif !== hoy) {
            n.notificadoHoy = false;
        }
    });

    const historial = localStorage.getItem('historialNotificaciones');
    if (historial) {
        appState.historial = JSON.parse(historial);
    }
}

function guardarEstado() {
    localStorage.setItem('appState', JSON.stringify(appState));
}

// ==================== ONE SIGNAL ====================
function inicializarOneSignal() {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    OneSignalDeferred.push(async function(OneSignal) {
        await OneSignal.init({
            appId: ONE_SIGNAL_APP_ID,
            notifyButton: {
                enable: true,
                size: 'large',
                position: 'bottom-right',
                prenotify: true,
                showCredit: false
            },
            welcomeNotification: {
                title: "💊 ¡Notificaciones activadas!",
                message: "Te recordaré tu suplemento y parche cada día 😉",
                url: window.location.href
            },
            autoResubscribe: true,
            allowLocalhostAsSecureOrigin: true,
            serviceWorkerParam: { scope: "/recordatorios-app-web/" },
            serviceWorkerPath: "/recordatorios-app-web/OneSignalSDKWorker.js",
        });

        await verificarSuscripcion();
        configurarListeners(OneSignal);
    });
}

function configurarListeners(OneSignal) {
    OneSignal.Notifications.addEventListener('click', async (event) => {
        const { action, notification } = event;
        const data = notification.data || {};

        switch(action) {
            case 'done':
                showMessage('✅ ¡Bien hecho!', 'success');
                marcarComoCompletado(data.tipo);
                break;
            case 'snooze':
                showMessage('⏰ Te recordaremos en 10 minutos', 'info');
                programarRecordatorio(data.tipo, 10);
                break;
            case 'pirata':
                showMessage('🏴‍☠️ ¡Jaja, eres un gran Garfio!', 'info');
                break;
            default:
                if (event.notification.url) {
                    window.open(event.notification.url, '_blank');
                }
        }
    });
}

async function verificarSuscripcion() {
    const OneSignal = window.OneSignal;
    if (!OneSignal) return;

    try {
        const subscription = await OneSignal.User.PushSubscription;
        appState.suscrito = subscription && subscription.optedIn === true;
    } catch (error) {
        appState.suscrito = false;
    }

    renderizarEstado();
}

// ==================== SUSCRIPCIÓN ====================
window.suscribir = async function() {
    const OneSignal = window.OneSignal;
    if (OneSignal) {
        await OneSignal.Notifications.requestPermission();
        setTimeout(async () => { await verificarSuscripcion(); }, 500);
    }
};

window.desuscribir = async function() {
    const OneSignal = window.OneSignal;
    if (OneSignal) {
        await OneSignal.User.PushSubscription.optOut();
        await verificarSuscripcion();
    }
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

    const options = {
        title: notificacion.titulo,
        body: notificacion.mensaje,
        icon: window.location.origin + '/icon-192x192.png',
        badge: window.location.origin + '/badge-72x72.png',
        data: { tipo: notificacion.id, hora: ahora.getHours(), fecha: fechaStr },
        requireInteraction: true,
        vibrate: [300, 200, 300, 200, 300],
        actions: [
            { action: 'done', title: '✅ ¡Hecho!' },
            { action: 'snooze', title: '⏰ Recordar en 10 min' }
        ]
    };

    if (notificacion.id === 'parche') {
        options.actions.push({ action: 'pirata', title: '🏴‍☠️ ¡Soy Garfio!' });
    }

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
        actions: [
            { action: 'done', title: '✅ ¡Hecho!' },
            { action: 'snooze', title: '⏰ En 10 min' }
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
    const notif = appState.historial.find(n => n.id === tipo && !n.completado);
    if (notif) {
        notif.completado = true;
        localStorage.setItem('historialNotificaciones', JSON.stringify(appState.historial));
        renderizarHistorial();
    }
}

// ==================== NOTIFICACIÓN DE PRUEBA ====================
window.enviarPrueba = async function() {
    if (!appState.suscrito) {
        showMessage('❌ Debes activar las notificaciones primero', 'error');
        return;
    }

    const OneSignal = window.OneSignal;
    const ahora = new Date();
    const horaStr = formatHour(ahora.getHours());

    const options = {
        title: "🧪 Notificación de prueba",
        body: "Si ves esto, las notificaciones funcionan correctamente!",
        icon: window.location.origin + '/icon-192x192.png',
        data: { tipo: 'prueba', hora: ahora.getHours() },
        requireInteraction: false,
        vibrate: [200, 100, 200],
        actions: [{ action: 'ok', title: '✅ Entendido' }]
    };

    try {
        if (Notification.permission === 'granted') {
            new Notification(options.title, options);
            showMessage('✅ Notificación de prueba enviada', 'success');
            agregarAlHistorial({
                id: 'prueba',
                titulo: "🧪 Notificación de prueba",
                mensaje: "Prueba manual",
                icono: "🧪",
                hora: horaStr,
                fecha: ahora.toLocaleDateString(),
                timestamp: ahora.toISOString(),
                leida: false,
                completado: false
            });
        } else {
            showMessage('❌ Permiso denegado para notificaciones', 'error');
        }
    } catch (error) {
        showMessage('❌ Error al enviar la prueba', 'error');
    }
};

// ==================== MODO NO MOLESTAR ====================
window.activarNoMolestar = function() {
    const finDelDia = new Date();
    finDelDia.setHours(23, 59, 59, 999);
    appState.dndActivo = true;
    appState.dndExpira = finDelDia.toISOString();
    guardarEstado();
    renderizarUI();
    showMessage('🔕 Modo No Molestar activo hasta medianoche', 'info');
};

window.desactivarNoMolestar = function() {
    appState.dndActivo = false;
    appState.dndExpira = null;
    guardarEstado();
    renderizarUI();
    showMessage('🔔 Modo No Molestar desactivado', 'success');
};

// ==================== MODAL NUEVA NOTIFICACIÓN ====================
function inicializarModal() {
    const modal = document.getElementById('modalNueva');
    const overlay = document.getElementById('modalOverlay');

    // Mostrar/ocultar opciones de repetición según tipo
    document.getElementById('tipoRepeticion').addEventListener('change', function() {
        document.getElementById('opcionesPeriodico').style.display =
            this.value === 'periodico' ? 'block' : 'none';
        document.getElementById('opcionesHora').style.display =
            this.value !== 'periodico' ? 'block' : 'none';
    });

    // Cerrar modal al click en overlay
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

window.guardarNotificacionPersonalizada = function() {
    const titulo = document.getElementById('nuevaTitulo').value.trim();
    const mensaje = document.getElementById('nuevaMensaje').value.trim();
    const icono = document.getElementById('nuevoIcono').value.trim() || '🔔';
    const tipo = document.getElementById('tipoRepeticion').value;

    if (!titulo || !mensaje) {
        showMessage('❌ Título y mensaje son obligatorios', 'error');
        return;
    }

    const nuevaNotif = {
        id: 'custom_' + Date.now(),
        titulo: icono + ' ' + titulo,
        mensaje,
        icono,
        activa: true,
        tipo,
        notificadoHoy: false,
        ultimaNotificacion: null,
        esBase: false
    };

    if (tipo === 'periodico') {
        nuevaNotif.horaInicio = parseInt(document.getElementById('horaInicioPeriodico').value) || 8;
        nuevaNotif.horaFin = parseInt(document.getElementById('horaFinPeriodico').value) || 22;
        nuevaNotif.intervalo = parseInt(document.getElementById('intervaloPeriodico').value) || 2;
    } else {
        nuevaNotif.hora = parseInt(document.getElementById('horaUnica').value) || 9;
    }

    appState.notificacionesPersonalizadas.push(nuevaNotif);
    guardarEstado();
    renderizarNotificaciones();
    cerrarModal();
    showMessage('✅ Recordatorio creado', 'success');
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

    // Cards base (suplemento y parche) — sin mensaje visible
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
                <span class="stat">📊 Hoy: ${appState.notificacionesHoy.suplemento || 0}</span>
                <span class="badge high">⚠️ Alta prioridad</span>
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
                <span class="stat">📊 Hoy: ${appState.notificacionesHoy.parche || 0}</span>
                <span class="badge high">⚠️ Alta prioridad</span>
                ${NOTIFICACIONES.parche.notificadoHoy ?
                    '<span class="badge done">✅ Notificado hoy</span>' :
                    '<span class="badge pending">⏳ Pendiente</span>'}
            </div>
        </div>`;

    // Cards personalizadas
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
                <button onclick="desactivarNoMolestar()" class="btn-small">❌ Desactivar</button>
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
    const minutoActual = ahora.getMinutes();
    const proximas = [];

    // Suplemento
    const suplemento = NOTIFICACIONES.suplemento;
    if (suplemento.activa) {
        for (let h = suplemento.horaInicio; h <= suplemento.horaFin; h += suplemento.intervalo) {
            if (h > horaActual) {
                proximas.push({ icono: suplemento.icono, titulo: 'Suplemento', horaFormateada: formatHour(h), tipo: 'Cada 3h' });
                break;
            }
        }
    }

    // Parche
    const parche = NOTIFICACIONES.parche;
    if (parche.activa && !parche.notificadoHoy && parche.horaUnica > horaActual) {
        proximas.push({ icono: parche.icono, titulo: 'Parche de Garfio', horaFormateada: formatHour(parche.horaUnica), tipo: 'Una vez' });
    }

    // Personalizadas
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
                ${item.completado ? '<span class="badge done">✅ Completado</span>' : ''}
            </div>
        </div>
    `).join('');
}

function actualizarContadores() {
    document.getElementById('suplementoCount').textContent = appState.notificacionesHoy.suplemento || 0;
    document.getElementById('parcheCount').textContent = appState.notificacionesHoy.parche || 0;
}

// ==================== TOGGLES ====================
window.toggleNotificacion = function(id) {
    if (NOTIFICACIONES[id]) {
        NOTIFICACIONES[id].activa = !NOTIFICACIONES[id].activa;
        guardarEstado();
        renderizarNotificaciones();
        renderizarProximasNotificaciones();
        const nombre = id === 'suplemento' ? 'del suplemento' : 'del parche';
        showMessage(NOTIFICACIONES[id].activa ? `✅ Recordatorio ${nombre} activado` : `❌ Recordatorio ${nombre} desactivado`, 'info');
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
function agregarAlHistorial(item) {
    appState.historial.unshift({ ...item, id: Date.now() });
    if (appState.historial.length > 50) appState.historial.pop();
    localStorage.setItem('historialNotificaciones', JSON.stringify(appState.historial));
    renderizarHistorial();
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