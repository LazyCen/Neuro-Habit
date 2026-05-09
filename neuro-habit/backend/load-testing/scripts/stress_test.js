import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics
const ErrorRate = new Rate('error_rate');
const AuthDuration = new Trend('auth_duration');
const ApiLatency = new Trend('api_latency');

// Test configuration
export const options = {
  scenarios: {
    // 1. Smoke test: Verify everything works with minimal load
    smoke: {
      executor: 'constant-vus',
      vus: 1,
      duration: '1m',
      tags: { test_type: 'smoke' },
    },
    // 2. Load test: Expected traffic
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 100 }, // Ramp up to 100
        { duration: '5m', target: 100 }, // Stay at 100
        { duration: '2m', target: 0 },   // Ramp down
      ],
      startTime: '1m',
      tags: { test_type: 'load' },
    },
    // 3. Stress test: Pushing limits to 1,000+
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5m', target: 100 },
        { duration: '10m', target: 500 },
        { duration: '10m', target: 1000 },
        { duration: '5m', target: 0 },
      ],
      startTime: '10m',
      tags: { test_type: 'stress' },
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'], // <1% errors
    http_req_duration: ['p(95)<500'], // 95% of requests < 500ms
    error_rate: ['rate<0.1'],
  },
};

// Configuration from environment variables (No hardcoded defaults for security)
const SUPABASE_URL = __ENV.SUPABASE_URL;
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY;
const API_URL = __ENV.API_URL || 'http://localhost:8000';
const TEST_USER_EMAIL = __ENV.TEST_USER_EMAIL;
const TEST_USER_PASSWORD = __ENV.TEST_USER_PASSWORD;

export default function () {
  // Validate that required env vars are present
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_USER_EMAIL || !TEST_USER_PASSWORD) {
    console.error('Missing required environment variables. Please check your .env file or environment settings.');
    return;
  }
  let token = null;

  // Group: Authentication
  group('Authentication', function () {
    const loginUrl = `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
    const payload = JSON.stringify({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
    });
    const params = {
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
    };

    const res = http.post(loginUrl, payload, params);
    const success = check(res, {
      'login successful': (r) => r.status === 200,
      'has access token': (r) => r.json('access_token') !== undefined,
    });

    if (success) {
      token = res.json('access_token');
      AuthDuration.add(res.timings.duration);
    } else {
      ErrorRate.add(1);
    }
  });

  if (!token) return;

  const authHeaders = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // Group: API Operations
  group('User Operations', function () {
    // 1. Health Check (Simulating background system monitoring)
    const healthRes = http.get(`${API_URL}/health`);
    check(healthRes, { 'health check ok': (r) => r.status === 200 });

    // 2. Fetch Insights
    const insightsRes = http.get(`${API_URL}/insights`, { headers: authHeaders });
    check(insightsRes, { 'fetch insights ok': (r) => r.status === 200 });
    ApiLatency.add(insightsRes.timings.duration);

    sleep(Math.random() * 2 + 1); // Think time: 1-3s

    // 3. Log Mood
    const moodPayload = JSON.stringify({
      mood: Math.floor(Math.random() * 10) + 1,
      note: 'Stress test mood log',
      timestamp: new Date().toISOString(),
    });
    const moodRes = http.post(`${API_URL}/mood`, moodPayload, { headers: authHeaders });
    check(moodRes, { 'log mood ok': (r) => r.status === 200 || r.status === 201 });

    // 4. Create Habit
    const habitPayload = JSON.stringify({
      title: `Habit ${Math.floor(Math.random() * 1000)}`,
    });
    const habitRes = http.post(`${API_URL}/habits`, habitPayload, { headers: authHeaders });
    check(habitRes, { 'create habit ok': (r) => r.status === 200 || r.status === 201 });

    // 5. Update Metrics
    const metricsPayload = JSON.stringify({
      steps: Math.floor(Math.random() * 10000),
      screen_time: Math.random() * 10,
      date: new Date().toISOString().split('T')[0],
    });
    const metricsRes = http.post(`${API_URL}/metrics`, metricsPayload, { headers: authHeaders });
    check(metricsRes, { 'update metrics ok': (r) => r.status === 200 || r.status === 201 });

    // 6. Bulk Operations (Simulating sync)
    const bulkMoodPayload = JSON.stringify([
      { mood: 5, note: 'Bulk 1', timestamp: new Date().toISOString() },
      { mood: 7, note: 'Bulk 2', timestamp: new Date().toISOString() },
    ]);
    const bulkRes = http.post(`${API_URL}/mood/bulk`, bulkMoodPayload, { headers: authHeaders });
    check(bulkRes, { 'bulk log ok': (r) => r.status === 200 });

    sleep(Math.random() * 5 + 2); // Think time: 2-7s
  });

  // Group: Websocket Simulation (Placeholder if enabled in future)
  // k6 supports WebSockets via 'k6/ws'
  /*
  group('Websocket Presence', function() {
    const url = `${SUPABASE_URL.replace('https', 'wss')}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;
    ws.connect(url, {}, function(socket) {
      socket.on('open', () => socket.send('ping'));
      socket.on('message', (data) => socket.close());
    });
  });
  */
}
