import http.server
import socketserver
import webbrowser
import os
import sys
import re
import socket

# --- CONFIGURATION ---
DEFAULT_PORT = 8000

class RangeRequestHandler(http.server.SimpleHTTPRequestHandler):
    """
    Custom server to handle Range Requests (required for PMTiles).
    """
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        http.server.SimpleHTTPRequestHandler.end_headers(self)

    def send_head(self):
        if 'Range' not in self.headers:
            return super().send_head()
        
        try:
            path = self.translate_path(self.path)
            if not os.path.isfile(path):
                return super().send_head()
            
            file_len = os.path.getsize(path)
            range_header = self.headers['Range']
            range_match = re.search(r'bytes=(\d+)-(\d*)', range_header)
            
            if range_match:
                start = int(range_match.group(1))
                end_str = range_match.group(2)
                end = int(end_str) if end_str else file_len - 1
                
                if start >= file_len:
                    self.send_error(416, 'Range Not Satisfiable')
                    return None
                
                self.send_response(206)
                self.send_header('Content-type', self.guess_type(path))
                self.send_header('Content-Range', f'bytes {start}-{end}/{file_len}')
                self.send_header('Content-Length', str(end - start + 1))
                self.end_headers()
                
                with open(path, 'rb') as f:
                    f.seek(start)
                    self.copyfile_slice(f, self.wfile, start, end)
                return None
                
        except BrokenPipeError:
            pass
        except Exception as e:
            print(f"[!] Server Error: {e}")
            self.send_error(500, str(e))
            
        return super().send_head()

    def copyfile_slice(self, source, outputfile, start, end):
        length = end - start + 1
        while length > 0:
            read_chunk = min(length, 64*1024)
            data = source.read(read_chunk)
            if not data: break
            outputfile.write(data)
            length -= len(data)

class ThreadingHTTPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

def create_viewer(filename):
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Inspector: {filename}</title>
    <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
    <style>
        body {{ margin: 0; padding: 0; font-family: sans-serif; }}
        #map {{ position: absolute; top: 0; bottom: 0; width: 100%; }}
        #hud {{
            position: absolute; top: 10px; left: 10px; z-index: 10;
            background: white; padding: 15px; width: 280px;
            border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            max-height: 90vh; display: flex; flex-direction: column;
        }}
        #layers-list {{
            overflow-y: auto; margin-top: 10px; padding-right: 5px;
            flex-grow: 1; border-top: 1px solid #eee;
        }}
        .layer-item {{
            display: flex; align-items: center; margin-bottom: 8px; font-size: 14px;
        }}
        .layer-item input[type="color"] {{
            border: none; width: 24px; height: 24px; cursor: pointer; margin-right: 10px; padding: 0; background: none;
        }}
        .error {{ color: red; font-weight: bold; }}
        .success {{ color: green; }}
    </style>
</head>
<body>

<div id="hud">
    <h3>PMTiles Inspector</h3>
    <div>File: <b>{filename}</b></div>
    <div id="status" style="margin: 5px 0; font-size: 0.9em; color: #666;">Loading...</div>
    <div id="layers-list"></div>
</div>

<div id="map"></div>

<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script src="https://unpkg.com/pmtiles@3.0.6/dist/pmtiles.js"></script>

<script>
    const status = document.getElementById('status');
    const layerList = document.getElementById('layers-list');
    const filename = "{filename}";

    function log(msg, type) {{
        status.innerHTML = msg;
        if(type) status.className = type;
        console.log(msg);
    }}

    function getRandomColor() {{
        // Generate a random HEX color
        return "#" + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    }}

    if (typeof pmtiles === 'undefined') {{
        log("CRITICAL: PMTiles library failed to load.", "error");
    }}

    try {{
        const protocol = new pmtiles.Protocol();
        maplibregl.addProtocol("pmtiles", protocol.tile);
        
        const map = new maplibregl.Map({{
            container: 'map',
            style: {{
                version: 8,
                sources: {{
                    'osm': {{
                        type: 'raster',
                        tiles: ['https://tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png'],
                        tileSize: 256,
                        attribution: '&copy; OpenStreetMap'
                    }},
                    'my_source': {{
                        type: "vector",
                        url: "pmtiles://" + window.location.href.replace('index.html','') + filename,
                        attribution: filename
                    }}
                }},
                layers: [
                    {{ "id": "osm", "type": "raster", "source": "osm" }}
                ]
            }},
            center: [0, 0],
            zoom: 0
        }});

        map.addControl(new maplibregl.NavigationControl());

        const p_url = window.location.href.replace('index.html','') + filename;
        const p = new pmtiles.PMTiles(p_url);

        p.getHeader().then(header => {{
            if (header.minLon) {{
                 map.fitBounds([[header.minLon, header.minLat], [header.maxLon, header.maxLat]], {{padding: 20}});
            }}
        }});

        p.getMetadata().then(metadata => {{
            let layers = [];
            if (metadata.vector_layers) layers = metadata.vector_layers;
            else if (metadata.json) {{
                try {{ layers = JSON.parse(metadata.json).vector_layers; }} catch(e){{}}
            }}

            if (!layers || layers.length === 0) {{
                 log("Loaded! (No layer names found)", "success");
            }} else {{
                 log(`Loaded! Found ${{layers.length}} layers`, "success");
                 
                 layers.forEach(l => {{
                    const id = l.id;
                    const color = getRandomColor();
                    
                    // 1. Add Map Layers
                    map.addLayer({{
                        id: id + "-fill", type: "fill", source: "my_source", "source-layer": id,
                        paint: {{ "fill-color": color, "fill-opacity": 0.3, "fill-outline-color": color }},
                        filter: ["==", "$type", "Polygon"]
                    }});
                    map.addLayer({{
                        id: id + "-line", type: "line", source: "my_source", "source-layer": id,
                        paint: {{ "line-color": color, "line-width": 1 }},
                        filter: ["==", "$type", "LineString"]
                    }});
                    map.addLayer({{
                        id: id + "-pt", type: "circle", source: "my_source", "source-layer": id,
                        paint: {{ "circle-color": color, "circle-radius": 3 }},
                        filter: ["==", "$type", "Point"]
                    }});

                    // 2. Add Controls to HUD
                    const row = document.createElement('div');
                    row.className = 'layer-item';
                    
                    const input = document.createElement('input');
                    input.type = 'color';
                    input.value = color;
                    
                    const label = document.createElement('span');
                    label.textContent = id;

                    // Event Listener: Change color on the fly
                    input.addEventListener('input', (e) => {{
                        const newColor = e.target.value;
                        // We try to update all 3 types (Fill, Line, Point) because we don't know 
                        // strictly which geometry this layer uses without inspecting every feature.
                        if(map.getLayer(id + "-fill")) {{
                            map.setPaintProperty(id + "-fill", 'fill-color', newColor);
                            map.setPaintProperty(id + "-fill", 'fill-outline-color', newColor);
                        }}
                        if(map.getLayer(id + "-line")) {{
                            map.setPaintProperty(id + "-line", 'line-color', newColor);
                        }}
                        if(map.getLayer(id + "-pt")) {{
                            map.setPaintProperty(id + "-pt", 'circle-color', newColor);
                        }}
                    }});

                    row.appendChild(input);
                    row.appendChild(label);
                    layerList.appendChild(row);
                 }});
            }}
        }}).catch(e => {{
            log("Error reading metadata: " + e.message, "error");
        }});

    }} catch(e) {{
        log("Error: " + e.message, "error");
    }}
</script>
</body>
</html>"""
    
    with open("index.html", "w", encoding="utf-8") as f:
        f.write(html)
    print(f"[-] Viewer generated for {filename}")

def get_free_port(port):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("", port))
            return port
    except OSError:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("", 0))
            return s.getsockname()[1]

# --- MAIN ---
if __name__ == "__main__":
    files = [f for f in os.listdir('.') if f.endswith('.pmtiles')]
    if not files:
        print("[!] No .pmtiles file found in this folder.")
        input("Press Enter to exit...")
        sys.exit()

    target = files[0]
    if len(files) > 1:
        print(f"[*] Found {len(files)} files. Using: {target}")
    else:
        print(f"[*] Found: {target}")

    create_viewer(target)
    
    final_port = get_free_port(DEFAULT_PORT)
    url = f"http://localhost:{final_port}/index.html"
    
    print(f"[*] Serving on port {final_port}")
    print(f"[*] Opening {url}")
    
    webbrowser.open(url)
    
    with ThreadingHTTPServer(("", final_port), RangeRequestHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopping server.")