import eel
import os
import sys
import sqlite3
import re
import base64
import numpy as np
import cv2
from datetime import datetime
import threading
import queue

VERSION = "1.0.6"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Initialize the 'web' folder for Eel
eel.init('web')

# --- VIDEO RECORDING GLOBALS ---
is_recording_active = False
video_writer = None
video_queue = queue.Queue()

def video_worker():
    """Background thread to process video frames safely without freezing the UI."""
    global video_writer
    while True:
        try:
            frame_data = video_queue.get(timeout=1)
            
            # If we receive the STOP signal, safely finalize the video file
            if frame_data == "STOP":
                if video_writer:
                    video_writer.release()
                    video_writer = None
                    print("✅ Video finalized and saved.")
                continue # Keep the thread alive for future recordings!
                
            # If a recording is actively writing, process the frame
            if video_writer:
                # Decode base64 frame from JS to OpenCV Image
                encoded_data = frame_data.split(',')[1]
                nparr = np.frombuffer(base64.b64decode(encoded_data), np.uint8)
                img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                video_writer.write(img)
                
        except queue.Empty:
            continue
        except Exception as e:
            print(f"Video Worker Error: {e}")

# Start the background video thread (It will run forever in the background)
threading.Thread(target=video_worker, daemon=True).start()

@eel.expose
def start_video_session(width, height):
    global is_recording_active, video_writer
    
    # Flush any stale frames out of the queue just in case
    while not video_queue.empty():
        try:
            video_queue.get_nowait()
        except queue.Empty:
            break
            
    filename = f"Map_Recording_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4"
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    video_writer = cv2.VideoWriter(filename, fourcc, 30.0, (width, height))
    is_recording_active = True
    print(f"Started recording: {filename}")
    return True

@eel.expose
def add_video_frame(data_obj):
    if is_recording_active:
        video_queue.put(data_obj)

@eel.expose
def finalize_video():
    global is_recording_active
    # Instantly tell JS to stop sending frames
    is_recording_active = False 
    # Tell the worker thread to finish the remaining queue and save the file
    video_queue.put("STOP")
    return True

@eel.expose
def save_screenshot(data_url):
    try:
        encoded_data = data_url.split(',')[1]
        nparr = np.frombuffer(base64.b64decode(encoded_data), np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        filename = f"Map_Screenshot_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
        cv2.imwrite(filename, img)
        print(f"Saved screenshot: {filename}")
        return True
    except Exception as e:
        print(f"Error saving screenshot: {e}")
        return False

# --- MULTI-PASS OFFLINE SEARCH ENGINE ---
@eel.expose
def search_location(query_str):
    db_path = os.path.join(BASE_DIR, "search_index.db")
    if not os.path.exists(db_path):
        return {"error": "Database 'search_index.db' not found. Please place it in the project root."}

    try:
        # Re-open the connection for each query to ensure thread safety with Eel
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        final_results = []
        
        # --- SCENARIO 1: User typed a comma (e.g. "High Street, LS1 2AB") ---
        # We split the query and search both parts separately so both show up in the dropdown!
        if ',' in query_str:
            parts = [p.strip() for p in query_str.split(',')]
            for part in parts:
                clean_part = re.sub(r'[^\w\s]', ' ', part).strip()
                words = clean_part.split()
                if words:
                    query_and = " AND ".join([f"{w}*" for w in words])
                    cursor.execute("""
                        SELECT DISTINCT name, obj_type, lat, lon 
                        FROM search_index 
                        WHERE name MATCH ? 
                        ORDER BY rank LIMIT 5
                    """, (query_and,))
                    final_results.extend(cursor.fetchall())
                    
        # --- SCENARIO 2: Standard Search (No comma) ---
        else:
            clean_q = re.sub(r'[^\w\s]', ' ', query_str).strip()
            words = clean_q.split()
            if words:
                # Try strict match first
                query_and = " AND ".join([f"{w}*" for w in words])
                cursor.execute("""
                    SELECT DISTINCT name, obj_type, lat, lon 
                    FROM search_index 
                    WHERE name MATCH ? 
                    ORDER BY rank LIMIT 10
                """, (query_and,))
                final_results.extend(cursor.fetchall())
                
                # If strict fails, try loose OR match
                if not final_results and len(words) > 1:
                    query_or = " OR ".join([f"{w}*" for w in words])
                    cursor.execute("""
                        SELECT DISTINCT name, obj_type, lat, lon 
                        FROM search_index 
                        WHERE name MATCH ? 
                        ORDER BY rank LIMIT 10
                    """, (query_or,))
                    final_results.extend(cursor.fetchall())

        conn.close()
        
        # Remove any duplicates that might have been found in multiple passes
        seen = set()
        formatted = []
        for r in final_results:
            identifier = f"{r[0]}-{r[2]:.4f}-{r[3]:.4f}" # Unique ID based on name and coords
            if identifier not in seen:
                seen.add(identifier)
                formatted.append({"name": r[0], "type": r[1], "lat": r[2], "lon": r[3]})
                
        # Return the top 12 best matches
        return formatted[:12]
        
    except Exception as e:
        print(f"Search Error: {e}")
        return {"error": "An error occurred while searching."}

if __name__ == "__main__":
    print(f"--- FORENSIC MAPPER [v{VERSION}] ---")
    try:
        eel.start('index.html', size=(1200, 800))
    except (SystemExit, MemoryError, KeyboardInterrupt):
        pass