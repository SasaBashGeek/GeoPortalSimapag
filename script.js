// CONFIGURACIÓN
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const SUPABASE_URL = 'https://uxscivjtrhsyivmjtype.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4c2Npdmp0cmhzeWl2bWp0eXBlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMjU1ODUsImV4cCI6MjA4NTkwMTU4NX0.coSECrrzni5OyyMxUZj9Pk39XbzI1GPg9c9xMZyAi1g';

const TABLES = { 
    PADRON: 'PADRON_2025', 
    SECTORES: 'SECTORES_2025_4326',
    USERS: 'USERSAUTH' 
};

const GUANAJUATO_CENTER = [21.019, -101.257];
const GUANAJUATO_ZOOM = isMobile ? 12 : 13;

// VARIABLES GLOBALES
let map = null, padronLayer = null, sectoresLayer = null;
let currentUser = null, loginTime = null, lastActivity = null;
let allPadronData = [], allSectoresData = [];
let filteredPadronData = [], filteredSectoresData = [];
let filterOptions = { 
    padron: { estatus: [], zona: [], sector: [], tarifa: [] }, 
    sectores: { sector: [], subsector: [], macrosector: [], zona: [] }
};
let addModeActive = false;

// FUNCIONES DE AUTENTICACIÓN Y REGISTRO
async function validateUser(username, password) {
    try {
        const headers = { 
            'apikey': SUPABASE_KEY, 
            'Authorization': `Bearer ${SUPABASE_KEY}`, 
            'Accept': 'application/json', 
            'Content-Type': 'application/json' 
        };
        const url = `${SUPABASE_URL}/rest/v1/${TABLES.USERS}?usuario=eq.${encodeURIComponent(username)}&contraseña=eq.${encodeURIComponent(password)}`;
        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error(`Error HTTP ${response.status}`);
        const users = await response.json();
        return users.length === 1 ? { success: true, user: users[0] } : { success: false, message: 'Credenciales incorrectas' };
    } catch (error) {
        console.error('Error validando usuario:', error);
        return { success: false, message: 'Error de conexión' };
    }
}

async function registerUser(username, password) {
    try {
        const headers = { 
            'apikey': SUPABASE_KEY, 
            'Authorization': `Bearer ${SUPABASE_KEY}`, 
            'Accept': 'application/json', 
            'Content-Type': 'application/json' 
        };
        
        const checkUrl = `${SUPABASE_URL}/rest/v1/${TABLES.USERS}?usuario=eq.${encodeURIComponent(username)}`;
        const checkResponse = await fetch(checkUrl, { headers });
        const existingUsers = await checkResponse.json();
        
        if (existingUsers.length > 0) {
            return { success: false, message: 'El nombre de usuario ya existe' };
        }
        
        const insertUrl = `${SUPABASE_URL}/rest/v1/${TABLES.USERS}`;
        const insertData = {
            usuario: username,
            contraseña: password
        };
        
        const insertResponse = await fetch(insertUrl, {
            method: 'POST',
            headers: {
                ...headers,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(insertData)
        });
        
        if (!insertResponse.ok) {
            const errorData = await insertResponse.json();
            console.error('Error al insertar:', errorData);
            throw new Error(`Error HTTP ${insertResponse.status}`);
        }
        
        const newUser = await insertResponse.json();
        return { success: true, user: newUser[0], message: 'Usuario registrado exitosamente' };
        
    } catch (error) {
        console.error('Error registrando usuario:', error);
        return { success: false, message: 'Error al registrar usuario: ' + error.message };
    }
}

// FUNCIÓN PARA CARGAR OPCIONES DE ESTATUS, ZONAS, VIALIDADES Y COLONIAS DESDE LA BASE DE DATOS
function loadFormOptions() {
    if (!allPadronData || allPadronData.length === 0) return;
    
    const estatusList = [...new Set(allPadronData
        .filter(item => item.Estatus && item.Estatus.toString().trim() !== '')
        .map(item => item.Estatus.toString().trim())
    )].sort();
    
    const zonas = [...new Set(allPadronData
        .filter(item => item.Zona && item.Zona.toString().trim() !== '')
        .map(item => item.Zona.toString().trim())
    )].sort();
    
    const vialidades = [...new Set(allPadronData
        .filter(item => item.Vialidad && item.Vialidad.toString().trim() !== '')
        .map(item => item.Vialidad.toString().trim())
    )].sort();
    
    const colonias = [...new Set(allPadronData
        .filter(item => item.Colonia && item.Colonia.toString().trim() !== '')
        .map(item => item.Colonia.toString().trim())
    )].sort();
    
    const zonaSelect = document.getElementById('point-map-zona');
    if (zonaSelect) {
        zonaSelect.innerHTML = '<option value="">Seleccione zona</option>';
        zonas.forEach(zona => {
            const option = document.createElement('option');
            option.value = zona;
            option.textContent = zona;
            zonaSelect.appendChild(option);
        });
    }
    
    const vialidadSelect = document.getElementById('point-map-vialidad');
    if (vialidadSelect) {
        vialidadSelect.innerHTML = '<option value="">Seleccione vialidad (opcional)</option>';
        vialidades.forEach(vialidad => {
            const option = document.createElement('option');
            option.value = vialidad;
            option.textContent = vialidad;
            vialidadSelect.appendChild(option);
        });
    }
    
    const coloniaSelect = document.getElementById('point-map-colonia');
    if (coloniaSelect) {
        coloniaSelect.innerHTML = '<option value="">Seleccione colonia (opcional)</option>';
        colonias.forEach(colonia => {
            const option = document.createElement('option');
            option.value = colonia;
            option.textContent = colonia;
            coloniaSelect.appendChild(option);
        });
    }
    
    console.log(`Opciones cargadas: ${estatusList.length} estatus, ${zonas.length} zonas, ${vialidades.length} vialidades, ${colonias.length} colonias`);
}

// FUNCIÓN PARA ACTUALIZAR LOS CHECKBOXES DE FILTROS
function updateFilterOptions() {
    if (!allPadronData || allPadronData.length === 0) return;
    
    const estatusOptions = [...new Set(allPadronData
        .filter(item => item.Estatus && item.Estatus.toString().trim() !== '')
        .map(item => item.Estatus.toString().trim())
    )].sort();
    
    const zonaOptions = [...new Set(allPadronData
        .filter(item => item.Zona && item.Zona.toString().trim() !== '')
        .map(item => item.Zona.toString().trim())
    )].sort();
    
    const sectorOptions = [...new Set(allPadronData
        .filter(item => item.Sector && item.Sector.toString().trim() !== '')
        .map(item => item.Sector.toString().trim())
    )].sort();
    
    const tarifaOptions = [...new Set(allPadronData
        .filter(item => item.Tarifa && item.Tarifa.toString().trim() !== '')
        .map(item => item.Tarifa.toString().trim())
    )].sort();
    
    filterOptions.padron = {
        estatus: estatusOptions,
        zona: zonaOptions,
        sector: sectorOptions,
        tarifa: tarifaOptions
    };
    
    populatePadronFilters(filterOptions.padron);
    
    console.log(`Filtros actualizados: ${estatusOptions.length} estatus, ${zonaOptions.length} zonas, ${sectorOptions.length} sectores, ${tarifaOptions.length} tarifas`);
}

// FUNCIÓN PARA CREAR NUEVO PUNTO EN PADRÓN_2025
async function createPointFromMap(pointData) {
    try {
        const headers = { 
            'apikey': SUPABASE_KEY, 
            'Authorization': `Bearer ${SUPABASE_KEY}`, 
            'Accept': 'application/json', 
            'Content-Type': 'application/json' 
        };
        
        const insertUrl = `${SUPABASE_URL}/rest/v1/${TABLES.PADRON}`;
        
        const insertResponse = await fetch(insertUrl, {
            method: 'POST',
            headers: {
                ...headers,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(pointData)
        });
        
        if (!insertResponse.ok) {
            const errorData = await insertResponse.json();
            console.error('Error al insertar punto:', errorData);
            throw new Error(`Error HTTP ${insertResponse.status}`);
        }
        
        const newPoint = await insertResponse.json();
        return { success: true, point: newPoint[0], message: 'Punto agregado exitosamente' };
        
    } catch (error) {
        console.error('Error creando punto:', error);
        return { success: false, message: 'Error al crear punto: ' + error.message };
    }
}

// MANEJADOR DE LOGIN
async function handleLogin(event) {
    event.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    const loginBtn = document.getElementById('login-btn');
    const errorDiv = document.getElementById('login-error');
    
    if (!username || !password) {
        errorDiv.textContent = 'Por favor, complete todos los campos';
        errorDiv.style.display = 'block';
        return;
    }
    
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> VERIFICANDO...';
    errorDiv.style.display = 'none';
    
    try {
        const result = await validateUser(username, password);
        if (result.success) {
            currentUser = result.user;
            loginTime = new Date();
            lastActivity = new Date();
            localStorage.setItem('geoportal_auth', JSON.stringify({ user: username, timestamp: loginTime.getTime() }));
            
            document.getElementById('login-container').style.display = 'none';
            document.getElementById('main-content').classList.remove('hidden');
            document.getElementById('login-box').style.display = 'block';
            document.getElementById('register-box').style.display = 'none';
            
            initAppAfterLogin();
        } else {
            errorDiv.textContent = result.message;
            errorDiv.style.display = 'block';
            loginBtn.disabled = false;
            loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> INICIAR SESIÓN';
            document.getElementById('password').value = '';
        }
    } catch (error) {
        errorDiv.textContent = 'Error de conexión. Intente nuevamente.';
        errorDiv.style.display = 'block';
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> INICIAR SESIÓN';
    }
}

// MANEJADOR DE REGISTRO
async function handleRegister(event) {
    event.preventDefault();
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value.trim();
    const confirmPassword = document.getElementById('reg-confirm-password').value.trim();
    const registerBtn = document.getElementById('register-btn');
    const messageDiv = document.getElementById('register-message');
    const errorDiv = document.getElementById('register-error');
    
    messageDiv.style.display = 'none';
    errorDiv.style.display = 'none';
    
    if (!username || !password || !confirmPassword) {
        errorDiv.textContent = 'Por favor, complete todos los campos';
        errorDiv.style.display = 'block';
        return;
    }
    
    if (username.length < 3) {
        errorDiv.textContent = 'El usuario debe tener al menos 3 caracteres';
        errorDiv.style.display = 'block';
        return;
    }
    
    if (password.length < 6) {
        errorDiv.textContent = 'La contraseña debe tener al menos 6 caracteres';
        errorDiv.style.display = 'block';
        return;
    }
    
    if (password !== confirmPassword) {
        errorDiv.textContent = 'Las contraseñas no coinciden';
        errorDiv.style.display = 'block';
        return;
    }
    
    registerBtn.disabled = true;
    registerBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> REGISTRANDO...';
    
    try {
        const result = await registerUser(username, password);
        
        if (result.success) {
            messageDiv.textContent = '✅ ¡Usuario registrado exitosamente! Ahora puede iniciar sesión.';
            messageDiv.style.display = 'block';
            errorDiv.style.display = 'none';
            
            document.getElementById('reg-username').value = '';
            document.getElementById('reg-password').value = '';
            document.getElementById('reg-confirm-password').value = '';
            
            setTimeout(() => {
                document.getElementById('register-box').style.display = 'none';
                document.getElementById('login-box').style.display = 'block';
                document.getElementById('username').value = username;
                document.getElementById('password').focus();
            }, 2000);
            
        } else {
            errorDiv.textContent = '❌ ' + result.message;
            errorDiv.style.display = 'block';
            messageDiv.style.display = 'none';
        }
        
    } catch (error) {
        errorDiv.textContent = '❌ Error al registrar: ' + error.message;
        errorDiv.style.display = 'block';
    } finally {
        registerBtn.disabled = false;
        registerBtn.innerHTML = '<i class="fas fa-check-circle"></i> REGISTRARSE';
    }
}

// MANEJADOR DE CREACIÓN DE PUNTO DESDE MAPA
async function handleCreatePointFromMap(event) {
    event.preventDefault();
    
    const rpu = document.getElementById('point-map-rpu').value.trim();
    const nombre = document.getElementById('point-map-nombre').value.trim();
    const lat = parseFloat(document.getElementById('selected-lat').textContent);
    const lng = parseFloat(document.getElementById('selected-lng').textContent);
    const zona = document.getElementById('point-map-zona').value;
    const estatus = document.getElementById('point-map-estatus').value;
    const tarifa = document.getElementById('point-map-tarifa').value;
    const vialidad = document.getElementById('point-map-vialidad').value;
    const colonia = document.getElementById('point-map-colonia').value;
    
    const createBtn = document.getElementById('create-point-map-btn');
    const messageDiv = document.getElementById('create-point-map-message');
    const errorDiv = document.getElementById('create-point-map-error');
    
    messageDiv.style.display = 'none';
    errorDiv.style.display = 'none';
    
    if (!rpu || !nombre || !zona || !estatus || !tarifa) {
        errorDiv.textContent = 'Por favor, complete todos los campos obligatorios';
        errorDiv.style.display = 'block';
        return;
    }
    
    if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) {
        errorDiv.textContent = 'Coordenadas no válidas. Seleccione una ubicación en el mapa.';
        errorDiv.style.display = 'block';
        return;
    }
    
    createBtn.disabled = true;
    createBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> AGREGANDO...';
    
    const pointData = {
        RPU: rpu,
        Nombre: nombre,
        Latitud: lat,
        Longitud: lng,
        Zona: zona,
        Estatus: estatus,
        Tarifa: tarifa,
        Vialidad: vialidad || null,
        Colonia: colonia || null
    };
    
    try {
        const result = await createPointFromMap(pointData);
        
        if (result.success) {
            messageDiv.textContent = '✅ ¡Punto agregado exitosamente!';
            messageDiv.style.display = 'block';
            errorDiv.style.display = 'none';
            
            const newPoint = {
                ...pointData,
                hasValidCoords: true
            };
            allPadronData.push(newPoint);
            
            document.getElementById('totalPadron').textContent = allPadronData.length.toLocaleString();
            const conCoordenadas = parseInt(document.getElementById('conCoordenadas').textContent.replace(/,/g, '')) + 1;
            document.getElementById('conCoordenadas').textContent = conCoordenadas.toLocaleString();
            
            updateFilterOptions();
            loadFormOptions();
            
            if (document.getElementById('togglePadron').checked) {
                const currentFilters = getSelectedPadronFilters();
                filteredPadronData = filterPadronData(allPadronData, currentFilters);
                displayPadronOnMap(filteredPadronData);
            }
            
            document.getElementById('point-map-rpu').value = '';
            document.getElementById('point-map-nombre').value = '';
            document.getElementById('point-map-zona').value = '';
            document.getElementById('point-map-estatus').value = '';
            document.getElementById('point-map-tarifa').value = '';
            document.getElementById('point-map-vialidad').value = '';
            document.getElementById('point-map-colonia').value = '';
            
            setTimeout(() => {
                document.getElementById('create-point-map-box').style.display = 'none';
            }, 1500);
            
        } else {
            errorDiv.textContent = '❌ ' + result.message;
            errorDiv.style.display = 'block';
            messageDiv.style.display = 'none';
        }
        
    } catch (error) {
        errorDiv.textContent = '❌ Error al crear punto: ' + error.message;
        errorDiv.style.display = 'block';
    } finally {
        createBtn.disabled = false;
        createBtn.innerHTML = '<i class="fas fa-plus-circle"></i> AGREGAR PUNTO';
    }
}

function updateUserInfo() {
    if (!currentUser) return;
    document.getElementById('logged-user').textContent = currentUser.usuario || 'Usuario';
    document.getElementById('login-time').textContent = loginTime.toLocaleString('es-ES');
    document.getElementById('last-activity').textContent = lastActivity.toLocaleString('es-ES');
}

function updateLastActivity() {
    lastActivity = new Date();
    document.getElementById('last-activity').textContent = lastActivity.toLocaleString('es-ES');
}

function handleLogout() {
    if (confirm('¿Está seguro de que desea cerrar sesión?')) {
        currentUser = loginTime = lastActivity = null;
        localStorage.removeItem('geoportal_auth');
        if (map) map.remove();
        map = padronLayer = sectoresLayer = null;
        addModeActive = false;
        document.getElementById('main-content').classList.add('hidden');
        document.getElementById('login-container').style.display = 'flex';
        document.getElementById('login-box').style.display = 'block';
        document.getElementById('register-box').style.display = 'none';
        document.getElementById('create-point-map-box').style.display = 'none';
        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
        document.getElementById('login-error').style.display = 'none';
        document.getElementById('login-btn').disabled = false;
        document.getElementById('login-btn').innerHTML = '<i class="fas fa-sign-in-alt"></i> INICIAR SESIÓN';
    }
}

// FUNCIÓN PARA ACTIVAR/DESACTIVAR MODO AGREGAR PUNTO
function toggleAddMode() {
    addModeActive = !addModeActive;
    const toggleBtn = document.getElementById('toggle-add-mode');
    const mapEl = document.getElementById('map');
    const tooltip = document.getElementById('add-mode-tooltip');
    
    if (addModeActive) {
        toggleBtn.classList.add('active');
        toggleBtn.innerHTML = '<i class="fas fa-check-circle"></i>';
        toggleBtn.title = 'Desactivar modo agregar punto';
        mapEl.classList.add('add-mode');
        tooltip.classList.add('active');
    } else {
        toggleBtn.classList.remove('active');
        toggleBtn.innerHTML = '<i class="fas fa-plus-circle"></i>';
        toggleBtn.title = 'Activar modo agregar punto';
        mapEl.classList.remove('add-mode');
        tooltip.classList.remove('active');
    }
}

// FUNCIONES DE MAPA
function initMap() {
    map = L.map('map', {
        tap: isTouchDevice, 
        dragging: true, 
        touchZoom: isTouchDevice, 
        scrollWheelZoom: true,
        doubleClickZoom: true, 
        boxZoom: true, 
        keyboard: true, 
        zoomControl: true,
        zoomSnap: 0.1, 
        zoomDelta: 0.5, 
        maxZoom: 19, 
        minZoom: 10, 
        inertia: true
    }).setView(GUANAJUATO_CENTER, GUANAJUATO_ZOOM);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap', 
        maxZoom: 19, 
        detectRetina: true
    }).addTo(map);
    
    L.control.zoom({ position: 'topright' }).addTo(map);
    
    map.on('click', function(e) {
        if (!addModeActive) return;
        
        document.getElementById('selected-lat').textContent = e.latlng.lat.toFixed(6);
        document.getElementById('selected-lng').textContent = e.latlng.lng.toFixed(6);
        document.getElementById('create-point-map-box').style.display = 'block';
    });
    
    const locateBtn = document.getElementById('mobile-locate-btn');
    locateBtn.addEventListener('click', () => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(pos => {
                map.setView([pos.coords.latitude, pos.coords.longitude], 15);
            }, error => {
                alert('No se pudo obtener la ubicación: ' + error.message);
            });
        } else alert('Geolocalización no soportada');
    });
    
    setTimeout(() => {
        map.invalidateSize();
        map._onResize();
    }, 100);
}

// FUNCIÓN PARA CARGAR DATOS CON PAGINACIÓN
async function loadTableDataWithPagination(tableName) {
    try {
        const headers = { 
            'apikey': SUPABASE_KEY, 
            'Authorization': `Bearer ${SUPABASE_KEY}`, 
            'Accept': 'application/json',
            'Prefer': 'count=exact'
        };
        
        let allData = [];
        let start = 0;
        const limit = 1000;
        
        const countUrl = `${SUPABASE_URL}/rest/v1/${tableName}?select=*&limit=1`;
        const countResponse = await fetch(countUrl, { 
            headers: { ...headers, 'Range': '0-0' } 
        });
        
        const contentRange = countResponse.headers.get('content-range');
        let totalRecords = 0;
        
        if (contentRange) {
            const match = contentRange.match(/\/(\d+)$/);
            if (match) totalRecords = parseInt(match[1]);
        }
        
        console.log(`Total de registros en ${tableName}: ${totalRecords}`);
        
        if (totalRecords === 0) totalRecords = 50000;
        
        updateProgress(0, totalRecords, `Cargando ${tableName}...`, tableName);
        
        while (start < totalRecords) {
            const rangeEnd = Math.min(start + limit - 1, totalRecords - 1);
            
            updateProgress(allData.length, totalRecords, `Cargando ${tableName}...`, tableName);
            
            headers['Range'] = `${start}-${rangeEnd}`;
            
            const url = `${SUPABASE_URL}/rest/v1/${tableName}?select=*`;
            const response = await fetch(url, { headers });
            
            if (!response.ok) {
                if (response.status === 416) {
                    break;
                }
                throw new Error(`Error HTTP ${response.status}`);
            }
            
            const batchData = await response.json();
            if (batchData.length === 0) {
                break;
            }
            
            allData.push(...batchData);
            start += limit;
            
            document.getElementById('batchInfo').innerHTML = 
                `<i class="fas fa-sync-alt fa-spin"></i> Cargando: ${allData.length.toLocaleString()} de ${totalRecords.toLocaleString()} registros`;
            
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        console.log(`${tableName}: ${allData.length} registros cargados de ${totalRecords} totales`);
        return allData;
        
    } catch (error) {
        console.error(`Error cargando ${tableName}:`, error);
        try {
            console.log('Intentando carga alternativa...');
            const altHeaders = {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Accept': 'application/json'
            };
            
            const url = `${SUPABASE_URL}/rest/v1/${tableName}?select=*`;
            const response = await fetch(url, { headers: altHeaders });
            
            if (response.ok) {
                const data = await response.json();
                console.log(`Carga alternativa exitosa: ${data.length} registros`);
                return data;
            }
        } catch (altError) {
            console.error('Error en carga alternativa:', altError);
        }
        
        throw error;
    }
}

function processPadronData(data) {
    const filters = { estatus: new Set(), zona: new Set(), sector: new Set(), tarifa: new Set() };
    let usuariosConCoordenadas = 0;
    let processedData = [];
    
    data.forEach(item => {
        try {
            if (item.Estatus && item.Estatus.toString().trim() !== '') filters.estatus.add(item.Estatus.toString().trim());
            if (item.Zona && item.Zona.toString().trim() !== '') filters.zona.add(item.Zona.toString().trim());
            if (item.Sector && item.Sector.toString().trim() !== '') filters.sector.add(item.Sector.toString().trim());
            if (item.Tarifa && item.Tarifa.toString().trim() !== '') filters.tarifa.add(item.Tarifa.toString().trim());
            
            let hasValidCoords = false;
            if (item.Longitud !== undefined && item.Latitud !== undefined) {
                const lng = parseFloat(item.Longitud), lat = parseFloat(item.Latitud);
                if (!isNaN(lng) && !isNaN(lat) && Math.abs(lng) > 0 && Math.abs(lat) > 0) {
                    hasValidCoords = true;
                    usuariosConCoordenadas++;
                }
            }
            
            processedData.push({ ...item, hasValidCoords: hasValidCoords });
        } catch (error) {
            console.log('Error procesando item del padrón:', error);
        }
    });
    
    return {
        data: processedData,
        filterOptions: {
            estatus: Array.from(filters.estatus).sort(),
            zona: Array.from(filters.zona).sort(),
            sector: Array.from(filters.sector).sort(),
            tarifa: Array.from(filters.tarifa).sort()
        },
        stats: {
            total: processedData.length,
            conCoordenadas: usuariosConCoordenadas,
            zonasUnicas: filters.zona.size,
            sectoresUnicos: filters.sector.size,
            estatusUnicos: filters.estatus.size,
            tarifasUnicas: filters.tarifa.size
        }
    };
}

function processSectoresData(data, tableName = 'SECTORES') {
    const filters = { sector: new Set(), subsector: new Set(), macrosector: new Set(), zona: new Set() };
    
    data.forEach(item => {
        try {
            if (item.Sector && item.Sector.toString().trim() !== '') filters.sector.add(item.Sector.toString().trim());
            if (item.Subsector && item.Subsector.toString().trim() !== '') filters.subsector.add(item.Subsector.toString().trim());
            if (item.Macrosector && item.Macrosector.toString().trim() !== '') filters.macrosector.add(item.Macrosector.toString().trim());
            
            if (item.ZONA && item.ZONA.toString().trim() !== '') {
                filters.zona.add(item.ZONA.toString().trim());
            } else if (item.Zona && item.Zona.toString().trim() !== '') {
                filters.zona.add(item.Zona.toString().trim());
            } else if (item.zona && item.zona.toString().trim() !== '') {
                filters.zona.add(item.zona.toString().trim());
            }
            
        } catch (error) {
            console.log(`Error procesando item de ${tableName}:`, error);
        }
    });
    
    return {
        data: data,
        filterOptions: {
            sector: Array.from(filters.sector).sort(),
            subsector: Array.from(filters.subsector).sort(),
            macrosector: Array.from(filters.macrosector).sort(),
            zona: Array.from(filters.zona).sort()
        }
    };
}

function populateCheckboxes(containerId, options) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    if (options.length > 0) {
        options.forEach(option => {
            const id = option.replace(/[^a-zA-Z0-9]/g, '_');
            const checkboxItem = document.createElement('div');
            checkboxItem.className = 'checkbox-item';
            checkboxItem.innerHTML = `<input type="checkbox" id="${containerId}_${id}" value="${option}">
                                     <label for="${containerId}_${id}">${option}</label>`;
            container.appendChild(checkboxItem);
        });
    } else {
        container.innerHTML = '<div class="filter-loading">No hay datos disponibles</div>';
    }
}

function populatePadronFilters(options) {
    populateCheckboxes('estatusCheckboxGroup', options.estatus);
    populateCheckboxes('zonaCheckboxGroup', options.zona);
    populateCheckboxes('sectorCheckboxGroup', options.sector);
    populateCheckboxes('tarifaCheckboxGroup', options.tarifa);
}

function populateSectoresFilters(options) {
    populateCheckboxes('sectorNombreCheckboxGroup', options.sector);
    populateCheckboxes('subsectorCheckboxGroup', options.subsector);
    populateCheckboxes('macrosectorCheckboxGroup', options.macrosector);
    populateCheckboxes('zonaSectorCheckboxGroup', options.zona);
}

function displayPadronOnMap(data) {
    if (padronLayer) {
        map.removeLayer(padronLayer);
        padronLayer = null;
    }
    
    const dataWithValidCoords = data.filter(item => item.hasValidCoords);
    
    if (dataWithValidCoords.length === 0) {
        console.log('No hay registros con coordenadas válidas para mostrar');
        return 0;
    }
    
    console.log(`Mostrando TODOS los ${dataWithValidCoords.length} registros con coordenadas (individuales)`);
    
    const opacity = parseInt(document.getElementById('opacityPadron').value) / 100;
    
    padronLayer = L.layerGroup();
    
    let markersAdded = 0;
    const totalMarkers = dataWithValidCoords.length;
    
    function createMarkersInBatch(batchSize = 1000) {
        const batches = [];
        for (let i = 0; i < totalMarkers; i += batchSize) {
            batches.push(dataWithValidCoords.slice(i, i + batchSize));
        }
        
        let currentBatch = 0;
        
        function processNextBatch() {
            if (currentBatch >= batches.length) {
                console.log(`Todos los ${totalMarkers} marcadores creados individualmente`);
                document.getElementById('batchInfo').innerHTML = 
                    `<i class="fas fa-check-circle"></i> ${totalMarkers.toLocaleString()} puntos mostrados individualmente`;
                return;
            }
            
            const batch = batches[currentBatch];
            
            batch.forEach(item => {
                try {
                    const lng = parseFloat(item.Longitud);
                    const lat = parseFloat(item.Latitud);
                    
                    if (isNaN(lng) || isNaN(lat)) return;
                    
                    let color = '#28a745';
                    if (item.Estatus) {
                        const estatus = String(item.Estatus).toLowerCase();
                        if (estatus.includes('suspend') || estatus.includes('susp')) {
                            color = '#ffc107';
                        } else if (estatus.includes('cancel') || estatus.includes('baja')) {
                            color = '#dc3545';
                        }
                    }
                    
                    if (item.Tarifa) {
                        const tarifa = String(item.Tarifa).toLowerCase();
                        if (tarifa.includes('doméstica') || tarifa.includes('domestica')) {
                            color = '#007bff';
                        } else if (tarifa.includes('comercial')) {
                            color = '#fd7e14';
                        }
                    }
                    
                    const marker = L.circleMarker([lat, lng], {
                        radius: isMobile ? 3 : 4,
                        fillColor: color,
                        color: '#ffffff',
                        weight: 1,
                        opacity: 0.8,
                        fillOpacity: opacity,
                        className: 'map-interaction'
                    });
                    
                    let popupContent = `<div style="max-width: 250px; font-size: 13px;">`;
                    popupContent += `<strong style="color: #28a745;">📋 Usuario</strong><br><hr style="margin: 5px 0;">`;
                    
                    if (item.RPU) popupContent += `<strong>RPU:</strong> ${item.RPU}<br>`;
                    if (item.Nombre) popupContent += `<strong>Nombre:</strong> ${item.Nombre}<br>`;
                    if (item.Vialidad) popupContent += `<strong>Vialidad:</strong> ${item.Vialidad}<br>`;
                    if (item.Colonia) popupContent += `<strong>Colonia:</strong> ${item.Colonia}<br>`;
                    if (item.Tarifa) popupContent += `<strong>Tarifa:</strong> ${item.Tarifa}<br>`;
                    if (item.Zona) popupContent += `<strong>Zona:</strong> ${item.Zona}<br>`;
                    if (item.Estatus) popupContent += `<strong>Estatus:</strong> ${item.Estatus}<br>`;
                    
                    popupContent += `</div>`;
                    
                    marker.bindPopup(popupContent);
                    marker.addTo(padronLayer);
                    
                    markersAdded++;
                    
                } catch (error) {
                    console.log('Error creando marcador:', error);
                }
            });
            
            if (currentBatch % 2 === 0 || currentBatch === batches.length - 1) {
                const progress = Math.round((markersAdded / totalMarkers) * 100);
                document.getElementById('batchInfo').innerHTML = 
                    `<i class="fas fa-sync-alt fa-spin"></i> Creando puntos: ${markersAdded.toLocaleString()} de ${totalMarkers.toLocaleString()} (${progress}%)`;
            }
            
            currentBatch++;
            
            setTimeout(processNextBatch, 10);
        }
        
        processNextBatch();
    }
    
    createMarkersInBatch();
    
    if (document.getElementById('togglePadron').checked) {
        padronLayer.addTo(map);
    }
    
    return dataWithValidCoords.length;
}

function displaySectoresOnMap(data) {
    if (sectoresLayer) {
        sectoresLayer.eachLayer(layer => {
            if (layer.label && layer.label.isOpen()) {
                map.removeLayer(layer.label);
            }
        });
        map.removeLayer(sectoresLayer);
        sectoresLayer = null;
    }
    
    if (data.length === 0) {
        console.log('No hay datos de sectores para mostrar');
        return 0;
    }
    
    console.log(`Procesando ${data.length} registros de sectores`);
    
    let polygonsDisplayed = 0;
    const layerGroup = L.layerGroup();
    const showLabelsAlways = data.length <= 30;
    
    data.forEach((item, index) => {
        try {
            let geometry = null;
            
            if (item.geom) {
                try {
                    if (typeof item.geom === 'string') {
                        geometry = JSON.parse(item.geom);
                    } else if (typeof item.geom === 'object') {
                        geometry = item.geom;
                    }
                } catch (e) {
                    console.log(`Error parseando geometría en item ${index}:`, e);
                }
            }
            
            if (geometry && geometry.type && geometry.coordinates) {
                try {
                    let polygon;
                    let labelText = '';
                    
                    if (item.Sector) {
                        labelText = `Sector ${item.Sector}`;
                        if (item.Subsector) {
                            labelText += ` - ${item.Subsector}`;
                        }
                    } else if (item.Nombre) {
                        labelText = item.Nombre;
                    } else {
                        labelText = `Sector ${index + 1}`;
                    }
                    
                    let fillColor = '#007bff';
                    if (item.Macrosector) {
                        const macrosectors = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
                        const colors = ['#007bff', '#28a745', '#fd7e14', '#6f42c1', '#e83e8c', '#20c997', '#ffc107', '#dc3545', '#6c757d', '#17a2b8'];
                        const idx = macrosectors.indexOf(item.Macrosector.toUpperCase());
                        if (idx !== -1) fillColor = colors[idx % colors.length];
                    }
                    
                    if (geometry.type === 'MultiPolygon' || geometry.type === 'Polygon') {
                        polygon = L.geoJSON(geometry, {
                            style: {
                                fillColor: fillColor,
                                color: '#ffffff',
                                weight: 2,
                                opacity: 0.8,
                                fillOpacity: parseInt(document.getElementById('opacitySectores').value) / 100
                            }
                        });
                        
                        const bounds = polygon.getBounds();
                        const center = bounds.getCenter();
                        
                        const label = L.tooltip({
                            permanent: showLabelsAlways,
                            direction: 'center',
                            className: 'sector-label',
                            interactive: false
                        })
                        .setContent(`<div style="font-weight: bold; color: white; text-shadow: 1px 1px 2px black; font-size: ${isMobile ? '10px' : '12px'};">${labelText}</div>`)
                        .setLatLng(center);
                        
                        polygon.label = label;
                        
                        if (!showLabelsAlways) {
                            let labelTimeout;
                            
                            polygon.on('mouseover', function() {
                                clearTimeout(labelTimeout);
                                if (this.label && !this.label.isOpen()) {
                                    this.label.addTo(map);
                                }
                            });
                            
                            polygon.on('mouseout', function() {
                                labelTimeout = setTimeout(() => {
                                    if (this.label && this.label.isOpen()) {
                                        map.removeLayer(this.label);
                                    }
                                }, 300);
                            });
                            
                            polygon.on('remove', function() {
                                if (this.label && this.label.isOpen()) {
                                    map.removeLayer(this.label);
                                }
                            });
                        }
                        
                        if (showLabelsAlways) {
                            polygon.on('add', function() {
                                if (this.label && !this.label.isOpen()) {
                                    this.label.addTo(map);
                                }
                            });
                        }
                    }
                    
                    if (polygon) {
                        let popupContent = `<div style="max-width: 250px; font-size: 13px;">`;
                        popupContent += `<strong style="color: #007bff;">🗺️ SECTOR</strong><br><hr style="margin: 5px 0;">`;
                        
                        if (item.Sector) popupContent += `<strong>Sector:</strong> ${item.Sector}<br>`;
                        if (item.Subsector) popupContent += `<strong>Subsector:</strong> ${item.Subsector}<br>`;
                        if (item.Macrosector) popupContent += `<strong>Macrosector:</strong> ${item.Macrosector}<br>`;
                        if (item.Nombre) popupContent += `<strong>Nombre:</strong> ${item.Nombre}<br>`;
                        if (item.ZONA) popupContent += `<strong>Zona:</strong> ${item.ZONA}<br>`;
                        else if (item.Zona) popupContent += `<strong>Zona:</strong> ${item.Zona}<br>`;
                        if (item.Area) popupContent += `<strong>Área:</strong> ${item.Area} m²<br>`;
                        
                        popupContent += `</div>`;
                        
                        polygon.bindPopup(popupContent);
                        polygon.addTo(layerGroup);
                        polygonsDisplayed++;
                    }
                } catch (error) {
                    console.log(`Error creando polígono en item ${index}:`, error);
                }
            }
            
        } catch (error) {
            console.log(`Error procesando item ${index} de sectores:`, error);
        }
    });
    
    sectoresLayer = layerGroup;
    
    if (document.getElementById('toggleSectores').checked && polygonsDisplayed > 0) {
        layerGroup.addTo(map);
        
        if (showLabelsAlways) {
            setTimeout(() => {
                layerGroup.eachLayer(layer => {
                    if (layer.label && !layer.label.isOpen()) {
                        layer.label.addTo(map);
                    }
                });
            }, 100);
        }
    }
    
    console.log(`${polygonsDisplayed} polígonos mostrados de sectores`);
    return polygonsDisplayed;
}

function getSelectedPadronFilters() {
    return {
        estatus: Array.from(document.querySelectorAll('#estatusCheckboxGroup input:checked')).map(cb => cb.value),
        zona: Array.from(document.querySelectorAll('#zonaCheckboxGroup input:checked')).map(cb => cb.value),
        sector: Array.from(document.querySelectorAll('#sectorCheckboxGroup input:checked')).map(cb => cb.value),
        tarifa: Array.from(document.querySelectorAll('#tarifaCheckboxGroup input:checked')).map(cb => cb.value)
    };
}

function filterPadronData(data, filters) {
    return data.filter(item => {
        if (filters.estatus.length > 0) {
            const itemEstatus = item.Estatus ? item.Estatus.toString().trim() : '';
            if (!filters.estatus.includes(itemEstatus)) return false;
        }
        if (filters.zona.length > 0) {
            const itemZona = item.Zona ? item.Zona.toString().trim() : '';
            if (!filters.zona.includes(itemZona)) return false;
        }
        if (filters.sector.length > 0) {
            const itemSector = item.Sector ? item.Sector.toString().trim() : '';
            if (!filters.sector.includes(itemSector)) return false;
        }
        if (filters.tarifa.length > 0) {
            const itemTarifa = item.Tarifa ? item.Tarifa.toString().trim() : '';
            if (!filters.tarifa.includes(itemTarifa)) return false;
        }
        return true;
    });
}

function applyPadronFilters() {
    try {
        updateLastActivity();
        const filters = getSelectedPadronFilters();
        filteredPadronData = filterPadronData(allPadronData, filters);
        const padronWithCoords = displayPadronOnMap(filteredPadronData);
        updateStats(padronWithCoords, 0);
        console.log(`Filtros aplicados. Mostrando ${filteredPadronData.length} registros, ${padronWithCoords} con coordenadas`);
    } catch (error) {
        console.error('Error aplicando filtros padrón:', error);
        showError('Error al aplicar filtros padrón: ' + error.message);
    }
}

function resetPadronFilters() {
    updateLastActivity();
    document.querySelectorAll('#estatusCheckboxGroup input, #zonaCheckboxGroup input, #sectorCheckboxGroup input, #tarifaCheckboxGroup input')
        .forEach(cb => cb.checked = true);
    filteredPadronData = [...allPadronData];
    const padronWithCoords = displayPadronOnMap(filteredPadronData);
    updateStats(padronWithCoords, 0);
}

function getSelectedSectoresFilters() {
    return {
        sector: Array.from(document.querySelectorAll('#sectorNombreCheckboxGroup input:checked')).map(cb => cb.value),
        subsector: Array.from(document.querySelectorAll('#subsectorCheckboxGroup input:checked')).map(cb => cb.value),
        macrosector: Array.from(document.querySelectorAll('#macrosectorCheckboxGroup input:checked')).map(cb => cb.value),
        zona: Array.from(document.querySelectorAll('#zonaSectorCheckboxGroup input:checked')).map(cb => cb.value)
    };
}

function filterSectoresData(data, filters) {
    return data.filter(item => {
        if (filters.sector.length > 0) {
            const itemSector = item.Sector ? item.Sector.toString().trim() : '';
            if (!filters.sector.includes(itemSector)) return false;
        }
        if (filters.subsector.length > 0) {
            const itemSubsector = item.Subsector ? item.Subsector.toString().trim() : '';
            if (!filters.subsector.includes(itemSubsector)) return false;
        }
        if (filters.macrosector.length > 0) {
            const itemMacrosector = item.Macrosector ? item.Macrosector.toString().trim() : '';
            if (!filters.macrosector.includes(itemMacrosector)) return false;
        }
        if (filters.zona.length > 0) {
            const itemZona = item.ZONA ? item.ZONA.toString().trim() : 
                              item.Zona ? item.Zona.toString().trim() : 
                              item.zona ? item.zona.toString().trim() : '';
            if (!filters.zona.includes(itemZona)) return false;
        }
        return true;
    });
}

function applySectoresFilters() {
    try {
        updateLastActivity();
        const filters = getSelectedSectoresFilters();
        filteredSectoresData = filterSectoresData(allSectoresData, filters);
        const sectoresCount = displaySectoresOnMap(filteredSectoresData);
        updateStats(0, sectoresCount);
        console.log(`Filtros aplicados a sectores. Mostrando ${sectoresCount} polígonos`);
    } catch (error) {
        console.error('Error aplicando filtros sectores:', error);
        showError('Error al aplicar filtros sectores: ' + error.message);
    }
}

function resetSectoresFilters() {
    updateLastActivity();
    document.querySelectorAll('#sectorNombreCheckboxGroup input, #subsectorCheckboxGroup input, #macrosectorCheckboxGroup input, #zonaSectorCheckboxGroup input')
        .forEach(cb => cb.checked = true);
    filteredSectoresData = [...allSectoresData];
    const sectoresCount = displaySectoresOnMap(filteredSectoresData);
    updateStats(0, sectoresCount);
}

function updateProgress(current, total, message = '', table = '') {
    const progressBar = document.getElementById('progressBar');
    const loadingInfo = document.getElementById('loadingInfo');
    const loadingDetails = document.getElementById('loadingDetails');
    
    let progress = 0;
    if (total > 0) {
        progress = Math.min(100, Math.round((current / total) * 100));
    }
    
    progressBar.style.width = `${progress}%`;
    progressBar.textContent = `${progress}%`;
    
    if (message) loadingInfo.textContent = message;
    
    let detailsText = `Cargados: ${current} ${total > 0 ? `de ${total}` : 'registros'}`;
    if (table) detailsText += ` (${table})`;
    loadingDetails.textContent = detailsText;
}

function updateStats(padronCount, sectoresCount) {
    const totalMostrando = padronCount + sectoresCount;
    document.getElementById('mostrando').textContent = totalMostrando.toLocaleString();
    document.getElementById('padronStats').textContent = `${filteredPadronData.length.toLocaleString()} registros | ${padronCount.toLocaleString()} con coord.`;
    document.getElementById('sectoresStats').textContent = `${sectoresCount.toLocaleString()} polígonos`;
    const batchInfo = document.getElementById('batchInfo');
    batchInfo.innerHTML = `<i class="fas fa-check-circle"></i> ${padronCount.toLocaleString()} puntos | ${sectoresCount.toLocaleString()} polígonos`;
    batchInfo.style.background = '#d4edda';
    batchInfo.style.color = '#155724';
    batchInfo.style.border = '1px solid #c3e6cb';
}

function showError(message) {
    const errorEl = document.getElementById('error');
    errorEl.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${message}`;
    errorEl.style.display = 'block';
    setTimeout(() => errorEl.style.display = 'none', 5000);
}

function setupSidebarToggle() {
    const sidebar = document.getElementById('sidebar');
    const toggleButton = document.getElementById('sidebar-toggle');
    toggleButton.classList.remove('hidden');
    
    toggleButton.addEventListener('click', function(e) {
        e.stopPropagation();
        sidebar.classList.toggle('collapsed');
        this.classList.toggle('collapsed');
        this.innerHTML = sidebar.classList.contains('collapsed') ? '<i class="fas fa-bars"></i>' : '<i class="fas fa-times"></i>';
        this.title = sidebar.classList.contains('collapsed') ? 'Mostrar panel' : 'Ocultar panel';
        setTimeout(() => { if (map) map.invalidateSize(); }, 300);
    });
    
    if (isMobile) {
        document.addEventListener('click', function(e) {
            if (!sidebar.contains(e.target) && !toggleButton.contains(e.target) && !sidebar.classList.contains('collapsed')) {
                sidebar.classList.add('collapsed');
                toggleButton.classList.add('collapsed');
                toggleButton.innerHTML = '<i class="fas fa-bars"></i>';
                setTimeout(() => { if (map) map.invalidateSize(); }, 300);
            }
        });
    }
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && !sidebar.classList.contains('collapsed')) {
            sidebar.classList.add('collapsed');
            toggleButton.classList.add('collapsed');
            toggleButton.innerHTML = '<i class="fas fa-bars"></i>';
            setTimeout(() => { if (map) map.invalidateSize(); }, 300);
        }
    });
}

function setupUIEvents() {
    document.getElementById('opacityPadron').addEventListener('input', function() {
        document.getElementById('opacityPadronValue').textContent = this.value + '%';
        if (padronLayer) {
            const opacity = parseInt(this.value) / 100;
            padronLayer.eachLayer(layer => {
                if (layer.setStyle) layer.setStyle({ fillOpacity: opacity });
            });
        }
    });
    
    document.getElementById('opacitySectores').addEventListener('input', function() {
        document.getElementById('opacitySectoresValue').textContent = this.value + '%';
        if (sectoresLayer) {
            const opacity = parseInt(this.value) / 100;
            sectoresLayer.eachLayer(layer => {
                if (layer.setStyle) layer.setStyle({ fillOpacity: opacity });
            });
        }
    });
    
    document.getElementById('btnResetView').addEventListener('click', () => { if (map) { map.setView(GUANAJUATO_CENTER, GUANAJUATO_ZOOM); updateLastActivity(); } });
    
    document.getElementById('btnClearAll').addEventListener('click', () => {
        if (sectoresLayer) {
            sectoresLayer.eachLayer(layer => {
                if (layer.label && layer.label.isOpen()) {
                    map.removeLayer(layer.label);
                }
            });
            map.removeLayer(sectoresLayer);
        }
        
        if (padronLayer) {
            map.removeLayer(padronLayer);
        }
        
        document.getElementById('mostrando').textContent = '0';
        document.getElementById('batchInfo').innerHTML = '<i class="fas fa-trash"></i> Mapa limpiado';
        updateLastActivity();
    });
    
    document.getElementById('btnForceReload').addEventListener('click', async function() {
        if (confirm('¿Forzar recarga completa de todos los datos? Esto puede tomar varios minutos.')) {
            this.disabled = true;
            this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Recargando...';
            
            try {
                allPadronData = [];
                allSectoresData = [];
                filteredPadronData = [];
                filteredSectoresData = [];
                
                document.getElementById('loading').classList.remove('hidden');
                document.getElementById('sidebar').classList.add('hidden');
                
                updateProgress(0, 0, 'Recargando datos...', 'RECARGA');
                document.getElementById('batchInfo').innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Iniciando recarga...';
                
                const padronRawData = await loadTableDataWithPagination(TABLES.PADRON);
                
                if (padronRawData.length > 0) {
                    const padronResult = processPadronData(padronRawData);
                    allPadronData = padronResult.data;
                    filteredPadronData = [...allPadronData];
                    filterOptions.padron = padronResult.filterOptions;
                    
                    try {
                        const sectoresRawData = await loadTableDataWithPagination(TABLES.SECTORES);
                        if (sectoresRawData.length > 0) {
                            const sectoresResult = processSectoresData(sectoresRawData, 'SECTORES');
                            allSectoresData = sectoresResult.data;
                            filteredSectoresData = [...allSectoresData];
                            filterOptions.sectores = sectoresResult.filterOptions;
                        }
                    } catch (error) {
                        console.log('No se pudieron cargar sectores:', error);
                    }
                    
                    document.getElementById('totalPadron').textContent = padronResult.stats.total.toLocaleString();
                    document.getElementById('conCoordenadas').textContent = padronResult.stats.conCoordenadas.toLocaleString();
                    document.getElementById('totalSectores').textContent = allSectoresData.length.toLocaleString();
                    
                    populatePadronFilters(filterOptions.padron);
                    populateSectoresFilters(filterOptions.sectores);
                    
                    loadFormOptions();
                    
                    document.getElementById('debugInfo').innerHTML = 
                        `<strong>Recarga completada:</strong><br>
                         • Padrón: ${allPadronData.length.toLocaleString()} registros<br>
                         • Sectores: ${allSectoresData.length.toLocaleString()} polígonos<br>
                         • Total con coordenadas: ${padronResult.stats.conCoordenadas.toLocaleString()}<br>
                         • <strong style="color: #28a745;">Todos los filtros DESMARCADOS por defecto</strong>`;
                    
                    alert(`Recarga completada:\n- ${allPadronData.length.toLocaleString()} registros de padrón\n- ${allSectoresData.length.toLocaleString()} registros de sectores\n\nTodos los filtros desmarcados.`);
                } else {
                    showError('No se pudieron cargar datos en la recarga');
                }
            } catch (error) {
                console.error('Error en recarga:', error);
                showError('Error en recarga: ' + error.message);
            } finally {
                this.disabled = false;
                this.innerHTML = '<i class="fas fa-redo"></i> Forzar Recarga';
                document.getElementById('loading').classList.add('hidden');
                document.getElementById('sidebar').classList.remove('hidden');
            }
        }
    });
    
    document.getElementById('btnApplyPadron').addEventListener('click', applyPadronFilters);
    document.getElementById('btnResetPadron').addEventListener('click', resetPadronFilters);
    
    document.getElementById('btnApplySectores').addEventListener('click', applySectoresFilters);
    document.getElementById('btnResetSectores').addEventListener('click', resetSectoresFilters);
    
    const setupSelectButtons = (allId, noneId, selector) => {
        document.getElementById(allId).addEventListener('click', () => {
            document.querySelectorAll(selector).forEach(cb => cb.checked = true);
            updateLastActivity();
        });
        document.getElementById(noneId).addEventListener('click', () => {
            document.querySelectorAll(selector).forEach(cb => cb.checked = false);
            updateLastActivity();
        });
    };
    
    setupSelectButtons('btnSelectAllEstatus', 'btnSelectNoneEstatus', '#estatusCheckboxGroup input');
    setupSelectButtons('btnSelectAllZona', 'btnSelectNoneZona', '#zonaCheckboxGroup input');
    setupSelectButtons('btnSelectAllSector', 'btnSelectNoneSector', '#sectorCheckboxGroup input');
    setupSelectButtons('btnSelectAllTarifa', 'btnSelectNoneTarifa', '#tarifaCheckboxGroup input');
    
    setupSelectButtons('btnSelectAllSectorNombre', 'btnSelectNoneSectorNombre', '#sectorNombreCheckboxGroup input');
    setupSelectButtons('btnSelectAllSubsector', 'btnSelectNoneSubsector', '#subsectorCheckboxGroup input');
    setupSelectButtons('btnSelectAllMacrosector', 'btnSelectNoneMacrosector', '#macrosectorCheckboxGroup input');
    setupSelectButtons('btnSelectAllZonaSector', 'btnSelectNoneZonaSector', '#zonaSectorCheckboxGroup input');
    
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', function() {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
            this.classList.add('active');
            document.getElementById(`tab-${this.dataset.tab}`).classList.add('active');
            updateLastActivity();
        });
    });
    
    document.getElementById('togglePadron').addEventListener('change', function() {
        if (padronLayer) this.checked ? padronLayer.addTo(map) : map.removeLayer(padronLayer);
        updateLastActivity();
    });
    
    document.getElementById('toggleSectores').addEventListener('change', function() {
        if (sectoresLayer) {
            if (this.checked) {
                sectoresLayer.addTo(map);
                if (filteredSectoresData.length <= 30) {
                    setTimeout(() => {
                        sectoresLayer.eachLayer(layer => {
                            if (layer.label && !layer.label.isOpen()) {
                                layer.label.addTo(map);
                            }
                        });
                    }, 100);
                }
            } else {
                sectoresLayer.eachLayer(layer => {
                    if (layer.label && layer.label.isOpen()) {
                        map.removeLayer(layer.label);
                    }
                });
                map.removeLayer(sectoresLayer);
            }
        }
        updateLastActivity();
    });
    
    document.getElementById('btnRefreshSession').addEventListener('click', () => { updateLastActivity(); alert('Sesión actualizada correctamente'); });
    document.getElementById('btnLogout').addEventListener('click', handleLogout);
    
    document.getElementById('toggle-add-mode').addEventListener('click', toggleAddMode);
    
    document.getElementById('create-point-map-form').addEventListener('submit', handleCreatePointFromMap);
    
    document.getElementById('close-create-point-map').addEventListener('click', function() {
        document.getElementById('create-point-map-box').style.display = 'none';
    });
}

async function initAppAfterLogin() {
    try {
        updateUserInfo();
        initMap();
        setupSidebarToggle();
        setupUIEvents();
        
        updateProgress(0, 0, 'Cargando PADRÓN 2025...', 'PADRÓN');
        document.getElementById('batchInfo').innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Iniciando carga de datos...';
        
        let padronRawData = [];
        try {
            padronRawData = await loadTableDataWithPagination(TABLES.PADRON);
        } catch (error) {
            console.error('Error cargando padrón:', error);
            showError('Error cargando datos completos. Mostrando datos disponibles.');
        }
        
        if (padronRawData.length === 0) {
            throw new Error('No se pudieron cargar datos del padrón');
        }
        
        updateProgress(padronRawData.length, padronRawData.length, 'Procesando datos del padrón...', 'PADRÓN');
        const padronResult = processPadronData(padronRawData);
        
        allPadronData = padronResult.data;
        filteredPadronData = [...allPadronData];
        filterOptions.padron = padronResult.filterOptions;
        
        document.getElementById('totalPadron').textContent = padronResult.stats.total.toLocaleString();
        document.getElementById('conCoordenadas').textContent = padronResult.stats.conCoordenadas.toLocaleString();
        
        updateProgress(0, 0, 'Cargando SECTORES 2025...', 'SECTORES');
        try {
            const sectoresRawData = await loadTableDataWithPagination(TABLES.SECTORES);
            if (sectoresRawData.length > 0) {
                const sectoresResult = processSectoresData(sectoresRawData, 'SECTORES');
                allSectoresData = sectoresResult.data;
                filteredSectoresData = [...allSectoresData];
                filterOptions.sectores = sectoresResult.filterOptions;
                document.getElementById('totalSectores').textContent = allSectoresData.length.toLocaleString();
            } else {
                console.log('No se encontraron datos en la tabla de sectores');
                document.getElementById('totalSectores').textContent = '0';
            }
        } catch (error) {
            console.log('No se pudieron cargar sectores:', error);
            document.getElementById('totalSectores').textContent = '0';
        }
        
        const zonasCargadas = filterOptions.padron.zona.length;
        console.log(`Zonas cargadas: ${zonasCargadas}`, filterOptions.padron.zona);
        
        updateProgress(0, 0, 'Configurando filtros...', 'FILTROS');
        populatePadronFilters(filterOptions.padron);
        populateSectoresFilters(filterOptions.sectores);
        
        loadFormOptions();
        
        const checkboxesEstatus = document.querySelectorAll('#estatusCheckboxGroup input[type="checkbox"]');
        const checkboxesZona = document.querySelectorAll('#zonaCheckboxGroup input[type="checkbox"]');
        
        console.log(`Checkboxes de estatus: ${checkboxesEstatus.length} (todos desmarcados)`);
        console.log(`Checkboxes de zona: ${checkboxesZona.length} (todos desmarcados)`);
        
        if (checkboxesZona.length === 0) {
            showError('No se cargaron opciones de zona. Los datos pueden estar incompletos.');
        }
        
        updateProgress(0, 0, 'Listo. Use filtros para mostrar datos...', 'MAPA');
        const padronWithCoords = 0;
        const sectoresCount = 0;
        
        document.getElementById('batchInfo').innerHTML = 
            `<i class="fas fa-info-circle"></i> Seleccione filtros y haga clic en "Aplicar Filtros"`;
        
        updateStats(0, 0);
        
        document.getElementById('debugInfo').innerHTML = 
            `<strong>Datos cargados:</strong><br>
             • Padrón: ${allPadronData.length.toLocaleString()} registros<br>
             • Sectores: ${allSectoresData.length.toLocaleString()} polígonos<br>
             • Total con coordenadas: ${padronResult.stats.conCoordenadas.toLocaleString()}<br>
             • Zonas únicas: ${zonasCargadas}<br>
             • <strong style="color: #28a745;">Activa el modo agregar punto con el botón azul</strong><br>
             • <strong>Seleccione filtros y haga clic en "Aplicar Filtros"</strong>`;
        
        updateProgress(100, 100, '¡Geoportal listo!', 'COMPLETO');
        setTimeout(() => {
            document.getElementById('loading').classList.add('hidden');
            document.getElementById('sidebar').classList.remove('hidden');
            console.log('Aplicación completamente inicializada - Filtros desmarcados por defecto');
            console.log(`Tablas cargadas: PADRÓN (${allPadronData.length}), SECTORES (${allSectoresData.length})`);
            
            map.setView(GUANAJUATO_CENTER, GUANAJUATO_ZOOM);
        }, 500);
        
    } catch (error) {
        console.error('Error en inicialización:', error);
        showError('Error crítico: ' + error.message);
        
        document.getElementById('loading').innerHTML = 
            `<div style="color: #dc3545; text-align: center;">
                <h3>Error al inicializar el geoportal</h3>
                <p>${error.message}</p>
                <p style="font-size: 12px; margin-top: 10px;">
                    Problema con la carga de datos. Verifica la conexión o contacta al administrador.
                </p>
                <button onclick="location.reload()" style="margin-top: 15px; padding: 10px 20px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    Reintentar
                </button>
            </div>`;
    }
}

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('register-form').addEventListener('submit', handleRegister);
    
    document.getElementById('show-register-btn').addEventListener('click', function() {
        document.getElementById('login-box').style.display = 'none';
        document.getElementById('register-box').style.display = 'block';
        document.getElementById('register-message').style.display = 'none';
        document.getElementById('register-error').style.display = 'none';
    });
    
    document.getElementById('back-to-login-from-register').addEventListener('click', function() {
        document.getElementById('register-box').style.display = 'none';
        document.getElementById('login-box').style.display = 'block';
        document.getElementById('login-error').style.display = 'none';
    });
    
    document.getElementById('password').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') document.getElementById('login-form').dispatchEvent(new Event('submit'));
    });
    
    if (isMobile) {
        document.getElementById('username').addEventListener('focus', () => {
            setTimeout(() => {
                document.getElementById('login-box').scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        });
    }
    
    window.addEventListener('orientationchange', () => setTimeout(() => { if (map) map.invalidateSize(); }, 300));
    window.addEventListener('resize', () => { if (map) map.invalidateSize(); });
});