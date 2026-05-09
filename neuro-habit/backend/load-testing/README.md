# NeuroHabit Load Testing & Performance Simulation

This directory contains a complete stress-testing and load-testing suite designed to validate the NeuroHabit backend's scalability and stability.

## Architecture
The testing suite uses **k6** (Grafana k6) as the primary load testing engine due to its high performance, developer-friendly JS scripting, and excellent integration with monitoring tools.

### Components
1. **k6 Script (`scripts/stress_test.js`)**: Simulates realistic user behavior including auth, data fetching, mood logging, habit creation, and metrics updates.
2. **Monitoring Stack (`docker-compose.yml`)**:
   - **InfluxDB**: Time-series database to store k6 metrics.
   - **Grafana**: Visualization dashboard to monitor real-time health and performance.
3. **CI/CD Integration**: Automated performance regression checks via GitHub Actions.

## Key Features
- **Realistic User Flow**: Simulates the full lifecycle of a NeuroHabit user.
- **Scenarios**:
  - **Smoke Test**: Quick verification of API health.
  - **Load Test**: Validates performance under expected traffic (100 concurrent users).
  - **Stress Test**: Pushes the system to its limits (1,000+ concurrent users).
  - **Soak Test**: Verifies stability over long durations (hours) to detect memory leaks.
  - **Spike Test**: Simulates sudden traffic bursts.
- **Metrics Tracked**:
  - Response Times (P95, P99)
  - Throughput (RPS)
  - Error Rates
  - Database Latency (via `/health` endpoint)
  - Auth Stability

## Getting Started

### Prerequisites
- Docker & Docker Compose
- k6 (optional, for running locally without Docker)

### 1. Configuration
Update the `.env` file in this directory with your test credentials and environment details:
```env
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key
API_URL=your_backend_url
TEST_USER_EMAIL=test@example.com
TEST_USER_PASSWORD=password
```

### 2. Run with Docker (Recommended)
This starts InfluxDB, Grafana, and runs the k6 test:
```bash
docker-compose up -d
```
Visit `http://localhost:3000` to view the Grafana dashboard.

### 3. Run Locally (k6 only)
```bash
k6 run scripts/stress_test.js
```

## Dashboard Analysis
The provided Grafana dashboard includes:
- **Success vs. Failure Rate**: Real-time error tracking.
- **Latency Heatmap**: Identifying slow endpoints.
- **Virtual Users (VU)**: Current active user count.
- **Data Throughput**: Request/Response volume.

## Optimizations Recommended
- Use connection pooling for Supabase (e.g., PgBouncer).
- Implement Redis caching for frequent `/insights` requests.
- Optimize the `get_dashboard_metrics` RPC call.
