const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:5000';
export async function timeline(){const r=await fetch(`${API}/timeline`,{cache:'no-store'});if(!r.ok)throw new Error('Timeline request failed');return r.json()}
export async function cluster(id){const r=await fetch(`${API}/clusters/${id}`,{cache:'no-store'});if(!r.ok)throw new Error('Cluster request failed');return r.json()}
export async function trigger(){const r=await fetch(`${API}/ingest/trigger`,{method:'POST'});if(!r.ok)throw new Error('Refresh failed');return r.json()}
export async function status(id){const r=await fetch(`${API}/ingest/status/${id}`,{cache:'no-store'});if(!r.ok)throw new Error('Status failed');return r.json()}
