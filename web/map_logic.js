// 1. Initialize Protocol for PMTiles
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

// --- GLOBAL STORAGE ---
let datasets = []; 
let activeDatasetId = null;
let globalFeatureIdCounter = 1;
let isSettingReference = false;
let listState = { points: [], filtered: [], rendered: 0, batchSize: 100 };

let mapState = { theme: 'dark', source: 'offline' };
let timeBounds = { min: 0, max: 0, start: 0, end: 0 };

// Playback & Recording
let isPlaying = false;
let playbackTimer = null;
let playbackSpeed = 1000;
let sortedPlaybackPoints = [];
let isRecording = false;
let recordInterval = null;
let playbackGroups = {};
let activeTravelerIds = [];

const colorPalette = [ '#38bdf8', '#fbbf24', '#34d399', '#a78bfa', '#f472b6', '#fb7185', '#22d3ee' ];

// --- RICH FORENSIC STYLES ---
const darkStyle = {
    version: 8, 
    name: "Forensic Dark",
    sources: { 'my-source': { type: 'vector', url: 'pmtiles://data/map.pmtiles' } },
    glyphs: "assets/fonts/{fontstack}/{range}.pbf",
    layers: [
        { "id": "background", "type": "background", "paint": { "background-color": "#0f172a" } },
        { "id": "landuse", "type": "fill", "source": "my-source", "source-layer": "landuse", "paint": { "fill-color": "#1e293b", "fill-opacity": 0.8 } },
        { "id": "landuse-green", "type": "fill", "source": "my-source", "source-layer": "landuse", "filter": ["in", "class", "park", "grass", "cemetery", "wood"], "paint": { "fill-color": "#065f46", "fill-opacity": 0.6 } },
        { "id": "water", "type": "fill", "source": "my-source", "source-layer": "water", "paint": { "fill-color": "#172554" } },
        { "id": "aeroway", "type": "fill", "source": "my-source", "source-layer": "aeroway", "paint": { "fill-color": "#334155" } },
        
        // 3D Buildings
        { 
            "id": "building-3d", "type": "fill-extrusion", "source": "my-source", "source-layer": "building", 
            "paint": { 
                "fill-extrusion-color": "#334155", 
                "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 13, 0, 15, ["get", "render_height"]],
                "fill-extrusion-base": ["interpolate", ["linear"], ["zoom"], 13, 0, 15, ["get", "render_min_height"]],
                "fill-extrusion-opacity": 0.8
            } 
        },

        // Boundaries
        { "id": "boundary", "type": "line", "source": "my-source", "source-layer": "boundary", "paint": { "line-color": "#475569", "line-width": 1, "line-dasharray": [2, 2] } },

        // Road Casings (Outline)
        { "id": "roads_casing", "type": "line", "source": "my-source", "source-layer": "transportation", "paint": { "line-color": "#000", "line-width": 3, "line-opacity": 0.5 } },
        // Road Inner
        { "id": "roads_minor", "type": "line", "source": "my-source", "source-layer": "transportation", "filter": ["all", ["!in", "class", "motorway", "trunk", "primary"]], "paint": { "line-color": "#475569", "line-width": 1 } },
        // Yellow/Amber for Major Roads in Dark Mode
        { "id": "roads_major", "type": "line", "source": "my-source", "source-layer": "transportation", "filter": ["in", "class", "motorway", "trunk", "primary"], "paint": { "line-color": "#f59e0b", "line-width": 2 } },
        
        // Labels
        { "id": "water-labels", "type": "symbol", "source": "my-source", "source-layer": "water_name", "layout": { "text-field": "{name}", "text-font": ["Noto Sans Regular"], "text-size": 11, "symbol-placement": "point" }, "paint": { "text-color": "#60a5fa", "text-halo-color": "#0f172a", "text-halo-width": 2 } },
        { "id": "road-labels", "type": "symbol", "source": "my-source", "source-layer": "transportation_name", "minzoom": 13, "layout": { "text-field": "{name}", "text-font": ["Noto Sans Regular"], "text-size": 10, "symbol-placement": "line" }, "paint": { "text-color": "#cbd5e1", "text-halo-color": "#0f172a", "text-halo-width": 2 } },
        { "id": "poi_labels", "type": "symbol", "source": "my-source", "source-layer": "poi", "minzoom": 14, "layout": { "text-field": "{name}", "text-font": ["Noto Sans Regular"], "text-size": 10, "text-variable-anchor": ["top", "bottom", "left", "right"] }, "paint": { "text-color": "#a5f3fc", "text-halo-color": "#0f172a", "text-halo-width": 2 } },
        { "id": "place-labels", "type": "symbol", "source": "my-source", "source-layer": "place", "layout": { "text-field": "{name}", "text-font": ["Noto Sans Regular"], "text-size": 14 }, "paint": { "text-color": "#f1f5f9", "text-halo-color": "#0f172a", "text-halo-width": 2 } }
    ]
};

const lightStyle = {
    version: 8,
    name: "Forensic Light",
    sources: { 'my-source': { type: 'vector', url: 'pmtiles://data/map.pmtiles' } },
    glyphs: "assets/fonts/{fontstack}/{range}.pbf",
    layers: [
        { "id": "background", "type": "background", "paint": { "background-color": "#f8fafc" } },
        { "id": "landuse", "type": "fill", "source": "my-source", "source-layer": "landuse", "paint": { "fill-color": "#e2e8f0", "fill-opacity": 0.7 } },
        // Standard Green for parks
        { "id": "landuse-green", "type": "fill", "source": "my-source", "source-layer": "landuse", "filter": ["in", "class", "park", "grass", "cemetery", "wood"], "paint": { "fill-color": "#86efac", "fill-opacity": 0.6 } },
        // Standard Blue for water
        { "id": "water", "type": "fill", "source": "my-source", "source-layer": "water", "paint": { "fill-color": "#60a5fa" } },
        { "id": "aeroway", "type": "fill", "source": "my-source", "source-layer": "aeroway", "paint": { "fill-color": "#cbd5e1" } },
        
        { 
            "id": "building-3d", "type": "fill-extrusion", "source": "my-source", "source-layer": "building", 
            "paint": { 
                "fill-extrusion-color": "#cbd5e1", 
                "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 13, 0, 15, ["get", "render_height"]],
                "fill-extrusion-base": ["interpolate", ["linear"], ["zoom"], 13, 0, 15, ["get", "render_min_height"]],
                "fill-extrusion-opacity": 0.8
            } 
        },

        { "id": "boundary", "type": "line", "source": "my-source", "source-layer": "boundary", "paint": { "line-color": "#94a3b8", "line-width": 1, "line-dasharray": [2, 2] } },

        { "id": "roads_casing", "type": "line", "source": "my-source", "source-layer": "transportation", "paint": { "line-color": "#94a3b8", "line-width": 3, "line-opacity": 0.3 } },
        { "id": "roads_minor", "type": "line", "source": "my-source", "source-layer": "transportation", "filter": ["all", ["!in", "class", "motorway", "trunk", "primary"]], "paint": { "line-color": "#ffffff", "line-width": 1 } },
        // Yellow/Orange for Major Roads
        { "id": "roads_major", "type": "line", "source": "my-source", "source-layer": "transportation", "filter": ["in", "class", "motorway", "trunk", "primary"], "paint": { "line-color": "#fbbf24", "line-width": 2.5 } },
        
        { "id": "water-labels", "type": "symbol", "source": "my-source", "source-layer": "water_name", "layout": { "text-field": "{name}", "text-font": ["Noto Sans Regular"], "text-size": 11, "symbol-placement": "point" }, "paint": { "text-color": "#2563eb", "text-halo-color": "#ffffff", "text-halo-width": 2 } },
        { "id": "road-labels", "type": "symbol", "source": "my-source", "source-layer": "transportation_name", "minzoom": 13, "layout": { "text-field": "{name}", "text-font": ["Noto Sans Regular"], "text-size": 10, "symbol-placement": "line" }, "paint": { "text-color": "#475569", "text-halo-color": "#ffffff", "text-halo-width": 2 } },
        { "id": "poi_labels", "type": "symbol", "source": "my-source", "source-layer": "poi", "minzoom": 14, "layout": { "text-field": "{name}", "text-font": ["Noto Sans Regular"], "text-size": 10, "text-variable-anchor": ["top", "bottom", "left", "right"] }, "paint": { "text-color": "#475569", "text-halo-color": "#ffffff", "text-halo-width": 2 } },
        { "id": "place-labels", "type": "symbol", "source": "my-source", "source-layer": "place", "layout": { "text-field": "{name}", "text-font": ["Noto Sans Regular"], "text-size": 14 }, "paint": { "text-color": "#1e293b", "text-halo-color": "#ffffff", "text-halo-width": 2 } }
    ]
};

const onlineStyle = {
    version: 8, 
    name: "Online",
    sources: { 'osm': { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256 } },
    layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' }]
};

const UI = {
    toggleMenu: () => document.getElementById('main-menu').classList.toggle('open'),
    toggleSubMenu: (btn, id) => {
        document.querySelectorAll('.submenu').forEach(el => { if(el.id !== id) el.classList.remove('open'); });
        document.querySelectorAll('.menu-item').forEach(el => { if(el !== btn) el.classList.remove('active'); });
        btn.classList.toggle('active');
        document.getElementById(id).classList.toggle('open');
    },
    togglePanel: (panelId, show) => { 
        const p = document.getElementById(panelId); 
        if(!p) return;
        if (show) p.classList.add('visible'); 
        else p.classList.remove('visible'); 
    },
    closePanel: (panelId, toggleId) => { 
        const p = document.getElementById(panelId);
        if(p) p.classList.remove('visible'); 
        if(toggleId) document.getElementById(toggleId).checked = false; 
    },
    setLoading: (show, text) => {
        const overlay = document.getElementById('processing-overlay');
        if (overlay) overlay.style.display = show ? 'flex' : 'none';
        if (text) document.getElementById('processing-text').innerText = text;
    },
    log: (msg) => { 
        const log = document.getElementById('trace-log'); 
        if(log) { 
            const d = document.createElement('div'); 
            d.innerText = `> ${msg}`; 
            log.prepend(d); 
        } 
    },
    updateTabs: () => {
        const c = document.getElementById('tabs-container'); 
        const searchBox = document.getElementById('search-container');
        if(!c) return; 
        c.innerHTML = '';
        
        if (datasets.length > 0) {
            searchBox.style.display = 'block';
            datasets.forEach(ds => {
                const b = document.createElement('button'); 
                b.className = activeDatasetId === ds.id ? 'active' : '';
                b.style.width = 'auto'; 
                b.style.padding = '10px 20px'; 
                b.style.flexShrink = '0';
                b.style.whiteSpace = 'nowrap';
                b.style.border = 'none';
                b.style.background = activeDatasetId === ds.id ? '#1e293b' : 'transparent';
                b.style.color = activeDatasetId === ds.id ? ds.color : '#94a3b8';
                b.style.fontWeight = '700';
                b.style.cursor = 'pointer';
                b.style.borderBottom = `3px solid ${activeDatasetId === ds.id ? ds.color : 'transparent'}`;
                b.innerText = ds.name;
                b.onclick = () => { 
                    activeDatasetId = ds.id; 
                    UI.updateTabs(); 
                    initLazyList(ds.data); 
                };
                c.appendChild(b);
            });
            
            const activeName = datasets.find(d => d.id === activeDatasetId)?.name || 'Subject';
            document.getElementById('list-search').placeholder = `Search in ${activeName}...`;
        } else {
            searchBox.style.display = 'none';
        }
    },
    updatePersonFilter: () => {
        const container = document.getElementById('personFilterContainer');
        if(!container) return;
        container.innerHTML = '';
        if (datasets.length === 0) { container.innerHTML = '<div style="font-size:11px; color:#a0aec0; text-align:center; padding:5px;">No imports</div>'; return; }
        datasets.forEach(ds => {
            const div = document.createElement('label');
            div.style = "display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer; padding: 2px 0;";
            div.innerHTML = `<input type="checkbox" value="${ds.name}" checked onchange="App.applyFilters()"><span style="width:8px; height:8px; border-radius:50%; background:${ds.color}"></span> ${ds.name}`;
            container.appendChild(div);
        });
    }
};

function initLazyList(data, query = "") {
    const list = document.getElementById('point-list');
    const scrollContainer = list.closest('.panel-body');
    if(!list || !scrollContainer) return;
    
    list.innerHTML = '';
    listState.points = data.features.filter(f => f.geometry.type === "Point" && f.properties.isVisible !== false);
    
    if (query) {
        const q = query.toLowerCase();
        listState.filtered = listState.points.filter(f => 
            f.properties.name.toLowerCase().includes(q) || 
            f.properties.dateStr.toLowerCase().includes(q)
        );
    } else {
        listState.filtered = listState.points;
    }

    listState.rendered = 0;
    scrollContainer.scrollTop = 0;
    renderNextBatch();
    
    scrollContainer.onscroll = () => {
        const currentPos = scrollContainer.scrollTop + scrollContainer.clientHeight;
        if (currentPos >= scrollContainer.scrollHeight - 50) {
            renderNextBatch();
        }
    };
}

function renderNextBatch() {
    if (listState.rendered >= listState.filtered.length) return;
    const nextBatch = listState.filtered.slice(listState.rendered, listState.rendered + listState.batchSize);
    appendBatch(nextBatch);
    listState.rendered += nextBatch.length;
}

function appendBatch(features) {
    const list = document.getElementById('point-list');
    const fragment = document.createDocumentFragment();
    features.forEach(feature => {
        const props = feature.properties;
        const li = document.createElement('li');
        li.className = 'point-item'; 
        li.id = `point-item-${feature.id}`; 
        li.style.borderLeftColor = props.color;
        li.innerHTML = `
            <div class="point-info" style="flex: 1; padding-right: 10px;">
                <span class="point-name" style="color:var(--text-main); font-weight: 600; display: block;">${props.name || 'Point'} <span style="opacity:0.5; font-weight:400;">#${props.pointIndex}</span></span>
                <div class="point-meta" style="margin-top: 2px;">
                    <span style="color:${props.color}; font-weight:bold; font-size: 10px;">${props.person}</span>
                    <span style="margin-left:8px; opacity:0.6; font-family:monospace; color:var(--text-muted); font-size: 10px;">${props.dateStr || ''}</span>
                </div>
            </div>
            <button style="width: auto; padding: 4px 12px; font-size: 11px; background:#334155; color:white; border:none; flex-shrink: 0;" onclick="App.focusPoint(${feature.id || 0})">Map</button>
        `;
        fragment.appendChild(li);
    });
    list.appendChild(fragment);
}

function renderAllForSync(data) {
    const list = document.getElementById('point-list');
    const remaining = data.features.filter(f => f.geometry.type === "Point" && f.properties.isVisible !== false).slice(listState.rendered);
    appendBatch(remaining);
    listState.rendered += remaining.length;
}

const App = {
    init: () => {
        // --- SMART FONT CHECK ---
        UI.log("SYSTEM: Checking fonts...");
        fetch("assets/fonts/Noto Sans Regular/0-255.pbf", { method: 'HEAD' })
            .then(res => {
                if (!res.ok) throw new Error("404");
                UI.log("SUCCESS: Local fonts found.");
                App.initMap();
            })
            .catch(() => {
                UI.log("WARNING: Local fonts missing. Enabling online fallback.", 'warn');
                const onlineFonts = "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf";
                darkStyle.glyphs = onlineFonts;
                lightStyle.glyphs = onlineFonts;
                App.initMap();
            });

        // Close modal on init if open
        App.closeImportWizard();
    },
    initMap: () => {
        window.map = new maplibregl.Map({ 
            container: 'map', style: darkStyle, center: [-1.65, 53.75], zoom: 12, preserveDrawingBuffer: true 
        });
        window.map.on('load', () => {
            App.generateMapIcons();
            App.setupLayers();
            UI.log("Map Loaded.");
        });

        window.map.on('click', 'kml-points', (e) => {
            const feature = e.features[0];
            const coords = feature.geometry.coordinates.slice();
            const props = feature.properties;
            const content = `<div style="font-family:sans-serif; padding:5px; color:#1e293b;">
                <strong style="color:${props.color}">${props.name} <span style="opacity:0.5">#${props.pointIndex}</span></strong><br>
                <span style="font-size:11px;">Person: ${props.person}</span><br>
                <span style="font-size:11px;">Time: ${props.dateStr || 'N/A'}</span><br>
                <hr style="margin:5px 0; border:none; border-top:1px solid #eee;">
                <code style="font-size:10px;">${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}</code>
            </div>`;
            new maplibregl.Popup({ offset: 10 }).setLngLat(coords).setHTML(content).addTo(window.map);
            UI.togglePanel('list-panel', true);
            const parentDs = datasets.find(ds => ds.name === props.person);
            if (parentDs && activeDatasetId !== parentDs.id) { activeDatasetId = parentDs.id; UI.updateTabs(); initLazyList(parentDs.data); }
            setTimeout(() => UI.syncSidebarToPoint(feature.id), 50);

            // Highlight selected point
            if (window.map.getLayer('kml-points-highlight')) {
                window.map.getSource('highlight-source').setData({
                    type: "FeatureCollection",
                    features: [feature]
                });
            }
        });
    },

    generateCarIcon: (color, id) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true }); // Optimized readback
        canvas.width = 64; canvas.height = 64;
        ctx.clearRect(0, 0, 64, 64);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(18, 20); ctx.lineTo(46, 20); ctx.quadraticCurveTo(54, 20, 54, 28); ctx.lineTo(54, 37); ctx.quadraticCurveTo(54, 45, 46, 45); ctx.lineTo(18, 45); ctx.quadraticCurveTo(10, 45, 10, 37); ctx.lineTo(10, 28); ctx.quadraticCurveTo(10, 20, 18, 20);
        ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.rect(16, 24, 32, 8); ctx.fill(); ctx.globalAlpha = 1.0;
        ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(20, 45, 6, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(44, 45, 6, 0, Math.PI * 2); ctx.fill();
        if (window.map.hasImage(id)) window.map.removeImage(id);
        window.map.addImage(id, ctx.getImageData(0, 0, 64, 64));
    },

    generateMapIcons: () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true }); // Optimized readback
        canvas.width = 64; canvas.height = 64;
        
        // 1. CAR ICON
        ctx.clearRect(0, 0, 64, 64);
        ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.roundRect(10, 20, 44, 25, 8); ctx.fill(); 
        ctx.fillStyle = '#cbd5e1'; ctx.beginPath(); ctx.roundRect(16, 24, 32, 10, 2); ctx.fill();
        ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(20, 45, 6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(44, 45, 6, 0, Math.PI * 2); ctx.fill();
        if (window.map.hasImage('icon-car')) window.map.removeImage('icon-car');
        window.map.addImage('icon-car', ctx.getImageData(0, 0, 64, 64));

        // 2. PIN ICON
        ctx.clearRect(0, 0, 64, 64);
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.translate(32, 32); 
        ctx.moveTo(0, 28); ctx.bezierCurveTo(-22, 6, -22, -10, -22, -10);
        ctx.arc(0, -10, 22, Math.PI, 0); ctx.bezierCurveTo(22, -10, 22, 6, 0, 28);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(0, -10, 8, 0, Math.PI * 2); ctx.fill();
        ctx.setTransform(1, 0, 0, 1, 0, 0); 
        if (window.map.hasImage('icon-target')) window.map.removeImage('icon-target');
        window.map.addImage('icon-target', ctx.getImageData(0, 0, 64, 64));
        
        datasets.forEach(ds => App.generateCarIcon(ds.color, `icon-car-${ds.id}`));
    },

    setupLayers: () => {
        const all = []; datasets.forEach(ds => ds.data.features.forEach(f => { if(f.properties.isVisible) all.push(f); }));
        if (!window.map.getSource('kml-source')) window.map.addSource('kml-source', { type: 'geojson', data: { type: "FeatureCollection", features: all } });
        if (!window.map.getLayer('kml-points')) window.map.addLayer({ id: 'kml-points', type: 'circle', source: 'kml-source', paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'], 'circle-stroke-width': 1, 'circle-stroke-color': mapState.theme === 'dark' ? '#000' : '#fff' } });
        
        // HIGHLIGHT LAYER
        if (!window.map.getSource('highlight-source')) window.map.addSource('highlight-source', { type: 'geojson', data: { type: "FeatureCollection", features: [] } });
        if (!window.map.getLayer('kml-points-highlight')) window.map.addLayer({ id: 'kml-points-highlight', type: 'circle', source: 'highlight-source', paint: { 'circle-radius': 9, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } });

        if (!window.map.getSource('playback_path')) window.map.addSource('playback_path', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        if (!window.map.getLayer('playback_line')) window.map.addLayer({ id: 'playback_line', type: 'line', source: 'playback_path', paint: { 'line-color': '#ef4444', 'line-width': 3, 'line-dasharray': [2, 1] } });
        if (!window.map.getSource('traveler_source')) window.map.addSource('traveler_source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        if (!window.map.getLayer('traveler_layer')) window.map.addLayer({ id: 'traveler_layer', type: 'symbol', source: 'traveler_source', layout: { 'icon-image': 'icon-car', 'icon-size': 0.6, 'icon-allow-overlap': true } });
        if (!window.map.getSource('reference_source')) window.map.addSource('reference_source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        if (!window.map.getLayer('reference_layer')) window.map.addLayer({ id: 'reference_layer', type: 'symbol', source: 'reference_source', layout: { 'icon-image': 'icon-target', 'icon-size': 0.7, 'icon-allow-overlap': true, 'icon-anchor': 'bottom' } });
    },

    toggleTheme: () => { mapState.theme = mapState.theme === 'dark' ? 'light' : 'dark'; document.getElementById('theme-toggle-btn').innerText = mapState.theme === 'dark' ? 'Light Mode' : 'Dark Mode'; App.applyMapStyle(); },
    toggleSource: () => { mapState.source = mapState.source === 'offline' ? 'online' : 'offline'; document.getElementById('source-toggle-btn').innerText = mapState.source === 'offline' ? 'Go Online' : 'Go Offline'; App.applyMapStyle(); },
    applyMapStyle: () => { let nextStyle = mapState.source === 'online' ? onlineStyle : (mapState.theme === 'dark' ? darkStyle : lightStyle); window.map.setStyle(nextStyle); window.map.once('style.load', () => { App.generateMapIcons(); App.setupLayers(); App.refreshAll(); }); },
    searchList: (val) => { const ds = datasets.find(d => d.id === activeDatasetId); if (ds) initLazyList(ds.data, val); },
    togglePlaybackLine: (visible) => { const layoutVal = visible ? 'visible' : 'none'; activeTravelerIds.forEach(id => { if (window.map.getLayer(`playback-line-${id}`)) window.map.setLayoutProperty(`playback-line-${id}`, 'visibility', layoutVal); }); },

    // --- IMPORT WIZARD ---
    openImportWizard: () => { document.getElementById('import-modal-overlay').style.display = 'flex'; const c = document.getElementById('import-rows-container'); if(c.children.length === 0) App.addImportRow(); },
    closeImportWizard: () => { document.getElementById('import-modal-overlay').style.display = 'none'; },
    addImportRow: () => {
        const c = document.getElementById('import-rows-container'); const idx = c.children.length + 1; const color = colorPalette[datasets.length % colorPalette.length];
        const row = document.createElement('div'); row.className = 'import-row';
        row.innerHTML = `<input type="text" class="import-name" placeholder="Name (e.g. Suspect 1)" value="Subject ${idx}"><input type="color" class="import-color" value="${color}"><input type="file" class="import-file" accept=".kml" multiple><button class="remove-row-btn" onclick="this.parentElement.remove()">×</button>`;
        c.appendChild(row);
    },
    
    processBatchImport: async () => {
        const rows = document.querySelectorAll('.import-row'); if (rows.length === 0) return;
        UI.setLoading(true, "Processing Batch Import..."); App.closeImportWizard();
        await new Promise(r => setTimeout(r, 100));
        
        try {
            for (const row of rows) {
                const name = row.querySelector('.import-name').value || "Unnamed";
                const color = row.querySelector('.import-color').value;
                const fileInput = row.querySelector('.import-file');
                
                if (fileInput.files.length === 0) continue;

                let targetDs = datasets.find(d => d.name === name);
                const isNew = !targetDs;

                if (isNew) {
                    targetDataset = {
                        id: `ds-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                        name: name,
                        color: color,
                        data: { type: "FeatureCollection", features: [] },
                        visible: true
                    };
                } else {
                    targetDataset.color = color;
                }

                for (const file of fileInput.files) {
                    try {
                        UI.log(`Parsing file: ${file.name}`);
                        const text = await new Promise(res => { const r = new FileReader(); r.onload=e=>res(e.target.result); r.readAsText(file); });
                        const geojson = App.fastKMLParser(text, name, targetDataset.color);
                        Array.prototype.push.apply(targetDataset.data.features, geojson.features);
                    } catch(e) { console.error(e); }
                }

                if (isNew) {
                    datasets.push(targetDataset);
                    App.generateCarIcon(targetDataset.color, `icon-car-${targetDataset.id}`);
                }
            }

            if (datasets.length > 0) {
                activeDatasetId = datasets[datasets.length-1].id;
                App.setupLayers();
                App.refreshAll();
                App.zoomToData();
                App.initTimeInputs();
                UI.updatePersonFilter();
                UI.updateTabs();
                UI.setLoading(false);
                UI.log("Batch Import Complete.");
            }
        } catch(e) {
            console.error(e);
            UI.log(`Import failed: ${e.message}`, 'err');
        } finally {
            UI.setLoading(false);
            document.getElementById('import-rows-container').innerHTML = ''; // Reset wizard
        }
    },

    loadKML: async (input) => { 
        // Backward compatibility if using simple menu
        App.openImportWizard(); 
    },

    initTimeInputs: () => {
        let minTs = Infinity, maxTs = -Infinity, found = false;
        datasets.forEach(ds => ds.data.features.forEach(f => { const ts = f.properties.timestamp || 0; if (ts !== 0) { minTs = Math.min(minTs, ts); maxTs = Math.max(maxTs, ts); found = true; } }));
        if (found) {
            timeBounds = { min: minTs, max: maxTs, start: minTs, end: maxTs };
            App.syncUIFromBounds();
            const startS = document.getElementById('timeline-start-slider'), endS = document.getElementById('timeline-end-slider');
            if(startS && endS) {
                startS.min = 0; startS.max = maxTs - minTs; startS.value = 0;
                endS.min = 0; endS.max = maxTs - minTs; endS.value = maxTs - minTs;
            }
            const tc = document.getElementById('timeline-container');
            if(tc) tc.style.display = 'flex';
        }
    },

    syncUIFromBounds: () => {
        const toDate = ts => new Date(ts).toISOString().split('T')[0];
        const toTime = ts => new Date(ts).toTimeString().split(' ')[0].substring(0,5);
        document.getElementById('filterStartDate').value = toDate(timeBounds.start);
        document.getElementById('filterStartTime').value = toTime(timeBounds.start);
        document.getElementById('filterEndDate').value = toDate(timeBounds.end);
        document.getElementById('filterEndTime').value = toTime(timeBounds.end);
        document.getElementById('timeline-label-start').innerText = new Date(timeBounds.start).toLocaleString();
        document.getElementById('timeline-label-end').innerText = new Date(timeBounds.end).toLocaleString();
    },

    applyManualFilters: () => {
        const sD = document.getElementById('filterStartDate').value, sT = document.getElementById('filterStartTime').value;
        const eD = document.getElementById('filterEndDate').value, eT = document.getElementById('filterEndTime').value;
        if(sD && sT) timeBounds.start = new Date(`${sD}T${sT}`).getTime();
        if(eD && eT) timeBounds.end = new Date(`${eD}T${eT}`).getTime();
        document.getElementById('timeline-start-slider').value = timeBounds.start - timeBounds.min;
        document.getElementById('timeline-end-slider').value = timeBounds.end - timeBounds.min;
        App.syncUIFromBounds(); App.applyFilters();
    },

    onTimelineScrub: (val, type) => {
        const targetTs = timeBounds.min + parseInt(val);
        if (type === 'start') { timeBounds.start = Math.min(targetTs, timeBounds.end); document.getElementById('timeline-start-slider').value = timeBounds.start - timeBounds.min; } 
        else { timeBounds.end = Math.max(targetTs, timeBounds.start); document.getElementById('timeline-end-slider').value = timeBounds.end - timeBounds.min; }
        App.syncUIFromBounds(); App.applyFilters();
    },

    fastKMLParser: (text, person, color) => {
        const features = [];
        const placemarkRegex = /<Placemark[\s\S]*?>([\s\S]*?)<\/Placemark>/g, coordRegex = /<coordinates>([\s\S]*?)<\/coordinates>/, nameRegex = /<name>(.*?)<\/name>/, whenRegex = /<when>(.*?)<\/when>|<begin>(.*?)<\/begin>/;
        let match;
        // Counter is per-file in this scope to provide #1, #2 relative to import if needed, 
        // but globalFeatureIdCounter is unique for map ID
        let localCounter = 1;
        
        while ((match = placemarkRegex.exec(text)) !== null) {
            const content = match[1], coordMatch = coordRegex.exec(content);
            if (!coordMatch) continue;
            const coordsText = coordMatch[1].trim().split(/\s+/)[0].split(',');
            if (coordsText.length < 2) continue;
            const nameMatch = nameRegex.exec(content), name = nameMatch ? nameMatch[1] : "Point";
            const timeMatch = whenRegex.exec(content);
            let timestamp = 0, dateStr = '';
            if (timeMatch) {
                const dateRaw = (timeMatch[1] || timeMatch[2]).trim();
                const d = new Date(dateRaw);
                if (!isNaN(d.getTime())) { timestamp = d.getTime(); dateStr = d.toLocaleString(); }
            }
            features.push({
                id: globalFeatureIdCounter++,
                type: "Feature",
                geometry: { type: "Point", coordinates: [parseFloat(coordsText[0]), parseFloat(coordsText[1])] },
                properties: { 
                    name, person, color, isVisible: true, timestamp, dateStr,
                    pointIndex: localCounter++ // ADDED Point Number
                }
            });
        }
        return { type: "FeatureCollection", features };
    },

    applyFilters: () => {
        const allowed = Array.from(document.querySelectorAll('#personFilterContainer input:checked')).map(c => c.value);
        const startVal = document.getElementById('filterStart').value;
        const endVal = document.getElementById('filterEnd').value;
        const start = startVal ? new Date(startVal).getTime() : 0;
        const end = endVal ? new Date(endVal).getTime() : Infinity;
        datasets.forEach(ds => {
            ds.visible = allowed.includes(ds.name);
            ds.data.features.forEach(f => {
                const ts = f.properties.timestamp || 0;
                const isNoFilter = (start === 0 && end === Infinity);
                const isTimeMatch = (ts !== 0 && ts >= start && ts <= end);
                f.properties.isVisible = ds.visible && (isNoFilter || isTimeMatch);
            });
        });
        App.refreshAll();
    },

    resetFilters: () => { App.initTimeInputs(); UI.toggleAllFilters(true); App.applyFilters(); },
    
    refreshAll: () => {
        const all = []; datasets.forEach(ds => ds.data.features.forEach(f => { if(f.properties.isVisible) all.push(f); }));
        const source = window.map.getSource('kml-source');
        if(source) {
            source.setData({ type: "FeatureCollection", features: all });
        } else {
            App.setupLayers();
        }
        const activeDS = datasets.find(d => d.id === activeDatasetId);
        if(activeDS) initLazyList(activeDS.data);
    },

    zoomToData: () => { const b = new maplibregl.LngLatBounds(); let hasData = false; datasets.forEach(ds => ds.data.features.forEach(f => { if (f.properties.isVisible && f.geometry.coordinates) { b.extend(f.geometry.coordinates); hasData = true; } })); if(hasData) window.map.fitBounds(b, { padding: 80, maxZoom: 15, duration: 1000 }); },
    focusPoint: (id) => {
        datasets.forEach(ds => {
            const f = ds.data.features.find(feat => feat.id === id);
            if(f) window.map.flyTo({ center: f.geometry.coordinates, zoom: 17 });
        });
    },
    enableRefMode: () => { isSettingReference = true; window.map.getCanvas().style.cursor = 'crosshair'; window.map.once('click', e => { window.map.getSource('reference_source').setData({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [e.lngLat.lng, e.lngLat.lat] } }] }); isSettingReference = false; window.map.getCanvas().style.cursor = ''; document.getElementById('ref-info').style.display = 'block'; document.getElementById('ref-coords-display').innerText = `${e.lngLat.lat.toFixed(4)}, ${e.lngLat.lng.toFixed(4)}`; }); },
    clearRefPoint: () => { window.map.getSource('reference_source').setData({ type: 'FeatureCollection', features: [] }); document.getElementById('ref-info').style.display = 'none'; },
    takeScreenshot: async () => { window.map.triggerRepaint(); requestAnimationFrame(async () => { const url = window.map.getCanvas().toDataURL('image/jpeg', 0.95); await eel.save_screenshot(url)(); UI.log("Captured."); }); },
    toggleRecording: async () => {
        const b = document.getElementById('record-btn');
        if (isRecording) { isRecording = false; if (recordInterval) clearInterval(recordInterval); b.classList.remove('recording-active'); b.innerText = "⏺ Record"; try { await eel.finalize_video()(); UI.log("Video saved."); } catch (e) {} } 
        else { const c = window.map.getCanvas(); const ok = await eel.start_video_session(Math.floor(c.width), Math.floor(c.height))(); if (ok) { isRecording = true; b.classList.add('recording-active'); b.innerText = "⏹ Stop"; recordInterval = setInterval(() => { if (isRecording) { window.map.triggerRepaint(); requestAnimationFrame(() => { if (isRecording) eel.add_video_frame(window.map.getCanvas().toDataURL('image/jpeg', 0.85)); }); } }, 1000/30); } }
    },
    startPlaybackSetup: () => {
        sortedPlaybackPoints = []; datasets.forEach(ds => { ds.data.features.forEach(f => { if (f.properties.isVisible) sortedPlaybackPoints.push(f); }); });
        sortedPlaybackPoints.sort((a, b) => (a.properties.timestamp || 0) - (b.properties.timestamp || 0));
        if (sortedPlaybackPoints.length < 2) return;
        window.map.getSource('playback_path').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: sortedPlaybackPoints.map(p => p.geometry.coordinates) } });
        document.getElementById('playback-bar').classList.add('visible');
        document.getElementById('playback-slider').max = sortedPlaybackPoints.length - 1;
        App.scrubPlayback(0);
    },
    stopPlayback: () => { if (isRecording) App.toggleRecording(); isPlaying = false; clearInterval(playbackTimer); document.getElementById('playback-bar').classList.remove('visible'); window.map.getSource('traveler_source').setData({ type: 'FeatureCollection', features: [] }); },
    togglePlayPause: () => { if (isPlaying) { isPlaying = false; clearInterval(playbackTimer); document.getElementById('play-pause-btn').innerText = "▶"; } else { isPlaying = true; document.getElementById('play-pause-btn').innerText = "⏸"; playbackTimer = setInterval(() => { const s = document.getElementById('playback-slider'); if (parseInt(s.value) >= sortedPlaybackPoints.length - 1) App.togglePlayPause(); else { s.value = parseInt(s.value) + 1; App.scrubPlayback(s.value); } }, playbackSpeed); } },
    scrubPlayback: (v) => { const p = sortedPlaybackPoints[parseInt(v)]; if(p) window.map.getSource('traveler_source').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: p.geometry.coordinates } }] }); },
    setPlaybackSpeed: (v) => { playbackSpeed = parseInt(v); if(isPlaying) { App.togglePlayPause(); App.togglePlayPause(); } },
    clearPoints: () => { datasets = []; activeDatasetId = null; App.refreshAll(); UI.updatePersonFilter(); UI.updateTabs(); document.getElementById('point-list').innerHTML = ''; document.getElementById('timeline-container').style.display='none'; document.getElementById('search-container').style.display='none'; UI.log("Data cleared."); }
};
App.init();
