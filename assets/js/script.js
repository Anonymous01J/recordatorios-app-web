// ==================== CONFIGURACIÓN ====================
const ONE_SIGNAL_APP_ID = 'TU_APP_ID_DE_ONESIGNAL'; // <-- REEMPLAZA ESTO

// Definición de las dos notificaciones
const NOTIFICACIONES = {
    suplemento: {
        id: 'suplemento',
        titulo: "💊 ¿Ya te tomaste tu suplemento?",
        mensaje: "Si no lo has hecho, hazlo. Que no te hice esto para que lo ignores 🙃",
        horaInicio: 12, // 12 PM
        horaFin: 21,    // 9 PM
        intervalo: 3,   // cada 3 horas
        activa: true,
        prioridad: 'high',
        icono: "💊",
        ultimaNotificacion: null,
        tipo: 'periodico'
    },
    parche: {
        id: 'parche',
        titulo: "🏴‍☠️ ¿Te pusiste tu parche hoy?",
        mensaje: "Si no lo has hecho, es tu momento de hacer Cosplay de Garfio 🪝",
        horaUnica: 21,   // 9 PM
        activa: true,
        prioridad: 'high',
        icono: "🪝",
        ultimaNotificacion: null,
        tipo: 'diario',
        notificadoHoy: false
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
    fechaUltimoParche: null
};

// ==================== INICIALIZACIÓN ====================
document.addEventListener('DOMContentLoaded', async () => {
    cargarEstadoGuardado();
    inicializarOneSignal();
    renderizarUI();
    iniciarVerificadorNotificaciones();
});

function cargarEstadoGuardado() {
    const guardado = localStorage.getItem('appState');
    if (guardado) {
        appState = JSON.parse(guardado);
    }
    
    // Resetear notificadoHoy si es nuevo día
    const hoy = new Date().toDateString();
    if (appState.fechaUltimoParche !== hoy) {
        NOTIFICACIONES.parche.notificadoHoy = false;
        appState.fechaUltimoParche = hoy;
    }
    
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
        });

        await verificarSuscripcion();
        configurarListeners(OneSignal);
    });
}

function configurarListeners(OneSignal) {
    OneSignal.Notifications.addEventListener('foregroundWillDisplay', (event) => {
        // Solo para depuración
    });
    
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
                // Abrir la app si hace clic en la notificación
                if (event.notification.url) {
                    window.open(event.notification.url, '_blank');
                }
        }
    });
}

async function verificarSuscripcion() {
    const OneSignal = window.OneSignal;
    if (!OneSignal) return;
    
    const isOptedIn = await OneSignal.Notifications.getPermission();
    const isSubscribed = await OneSignal.User.PushSubscription.optedIn;
    
    appState.suscrito = isOptedIn && isSubscribed;
    renderizarEstado();
}

// ==================== FUNCIONES DE SUSCRIPCIÓN ====================
window.suscribir = async function() {
    const OneSignal = window.OneSignal;
    if (OneSignal) {
        await OneSignal.Notifications.requestPermission();
        await verificarSuscripcion();
    }
};

window.desuscribir = async function() {
    const OneSignal = window.OneSignal;
    if (OneSignal) {
        await OneSignal.User.PushSubscription.optOut();
        await verificarSuscripcion();
    }
};

// ==================== VERIFICADOR DE NOTIFICACIONES ====================
function iniciarVerificadorNotificaciones() {
    setInterval(verificarNotificaciones, 60000); // cada minuto
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
    
    // Parche (solo 9pm)
    const parche = NOTIFICACIONES.parche;
    if (parche.activa && !parche.notificadoHoy) {
        if (horaActual === parche.horaUnica && minutoActual === 0) {
            enviarNotificacion(parche);
            parche.notificadoHoy = true;
            appState.fechaUltimoParche = new Date().toDateString();
            guardarEstado();
        }
    }
}

async function enviarNotificacion(notificacion) {
    if (appState.dndActivo) {
        agregarAlHistorial({
            ...notificacion,
            omitida: true,
            razon: 'Modo No Molestar'
        });
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
        data: {
            tipo: notificacion.id,
            hora: ahora.getHours(),
            fecha: fechaStr
        },
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
    
    const OneSignal = window.OneSignal;
    if (OneSignal && await OneSignal.User.PushSubscription.optedIn) {
        await OneSignal.Notifications.sendSelf(options);
    } else {
        if (Notification.permission === 'granted') {
            new Notification(options.title, options);
        }
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

function programarRecordatorio(tipo, minutos) {
    setTimeout(() => {
        const notif = NOTIFICACIONES[tipo];
        if (notif && notif.activa) {
            enviarNotificacion(notif);
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

// ==================== FUNCIONES DE UI ====================
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
    
    container.innerHTML = `
        <div class="notificaciones-grid">
            <!-- Suplemento -->
            <div class="notificacion-card ${NOTIFICACIONES.suplemento.activa ? 'activa' : ''}">
                <div class="notif-header">
                    <span class="notif-icon">💊</span>
                    <span class="notif-title">Suplemento (Cada 3h)</span>
                    <label class="switch">
                        <input type="checkbox" 
                               ${NOTIFICACIONES.suplemento.activa ? 'checked' : ''} 
                               onchange="toggleNotificacion('suplemento')">
                        <span class="slider"></span>
                    </label>
                </div>
                <div class="notif-message">
                    "Si no lo has hecho, hazlo. Que no te hice esto para que lo ignores 🙃"
                </div>
                <div class="notif-schedule">
                    📅 Horario: 12:00 PM, 3:00 PM, 6:00 PM, 9:00 PM
                </div>
                <div class="notif-stats">
                    <span class="stat">📊 Hoy: ${appState.notificacionesHoy.suplemento || 0}</span>
                    <span class="badge high">⚠️ Prioridad alta</span>
                </div>
            </div>
            <!-- Parche -->
            <div class="notificacion-card ${NOTIFICACIONES.parche.activa ? 'activa' : ''}">
                <div class="notif-header">
                    <span class="notif-icon">🪝</span>
                    <span class="notif-title">Parche de Garfio (Una vez al día)</span>
                    <label class="switch">
                        <input type="checkbox" 
                               ${NOTIFICACIONES.parche.activa ? 'checked' : ''} 
                               onchange="toggleNotificacion('parche')">
                        <span class="slider"></span>
                    </label>
                </div>
                <div class="notif-message">
                    "Si no lo has hecho, es tu momento de hacer Cosplay de Garfio 🪝"
                </div>
                <div class="notif-schedule">
                    📅 Horario: 9:00 PM (solo una vez al día)
                </div>
                <div class="notif-stats">
                    <span class="stat">📊 Hoy: ${appState.notificacionesHoy.parche || 0}</span>
                    <span class="badge high">⚠️ Prioridad alta</span>
                    ${NOTIFICACIONES.parche.notificadoHoy ? 
                        '<span class="badge done">✅ Notificado hoy</span>' : 
                        '<span class="badge pending">⏳ Pendiente para hoy</span>'}
                </div>
            </div>
        </div>
    `;
}

function renderizarControlesNoMolestar() {
    const container = document.getElementById('dndControls');
    if (!container) return;
    
    if (appState.dndActivo) {
        const expira = new Date(appState.dndExpira);
        container.innerHTML = `
            <div class="dnd-banner">
                <span>🔕 Modo No Molestar activo hasta ${expira.toLocaleTimeString()}</span>
                <button onclick="desactivarNoMolestar()" class="btn-small">❌ Desactivar</button>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="dnd-controls">
                <h3>🔕 ¿Quieres desconectar por hoy?</h3>
                <p>Silencia ambos recordatorios hasta mañana</p>
                <button onclick="activarNoMolestar()" class="btn-dnd">
                    🌙 No molestar hasta mañana
                </button>
            </div>
        `;
    }
}

function renderizarProximasNotificaciones() {
    const container = document.getElementById('proximasContainer');
    if (!container) return;
    
    const ahora = new Date();
    const horaActual = ahora.getHours();
    const minutoActual = ahora.getMinutes();
    
    const proximas = [];
    
    // Próximo suplemento
    const suplemento = NOTIFICACIONES.suplemento;
    if (suplemento.activa) {
        for (let h = suplemento.horaInicio; h <= suplemento.horaFin; h += suplemento.intervalo) {
            if (h > horaActual || (h === horaActual && minutoActual < 60)) {
                proximas.push({
                    ...suplemento,
                    horaProxima: h,
                    horaFormateada: formatHour(h),
                    tipo: 'Cada 3h'
                });
                break;
            }
        }
    }
    
    // Próximo parche
    const parche = NOTIFICACIONES.parche;
    if (parche.activa && !parche.notificadoHoy && parche.horaUnica > horaActual) {
        proximas.push({
            ...parche,
            horaProxima: parche.horaUnica,
            horaFormateada: formatHour(parche.horaUnica),
            tipo: 'Una vez'
        });
    }
    
    if (proximas.length === 0) {
        container.innerHTML = `<p class="text-muted">No hay más notificaciones por hoy</p>`;
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

// ==================== TOGGLE NOTIFICACIONES ====================
window.toggleNotificacion = function(id) {
    if (NOTIFICACIONES[id]) {
        NOTIFICACIONES[id].activa = !NOTIFICACIONES[id].activa;
        guardarEstado();
        renderizarNotificaciones();
        renderizarProximasNotificaciones();
        
        const mensaje = NOTIFICACIONES[id].activa ? 
            `✅ Recordatorio ${id === 'suplemento' ? 'del suplemento' : 'del parche'} activado` : 
            `❌ Recordatorio ${id === 'suplemento' ? 'del suplemento' : 'del parche'} desactivado`;
        showMessage(mensaje, 'info');
    }
};

// ==================== HISTORIAL ====================
function agregarAlHistorial(item) {
    appState.historial.unshift({
        ...item,
        id: Date.now()
    });
    
    if (appState.historial.length > 50) {
        appState.historial.pop();
    }
    
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