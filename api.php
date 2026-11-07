<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

function respond(int $status, mixed $payload = null): never
{
    http_response_code($status);
    if ($payload !== null) {
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }
    exit;
}

function readEnvFile(string $file): array
{
    if (!is_readable($file)) {
        respond(500, ['error' => 'Arquivo .env do LevFin não encontrado ou sem permissão de leitura.']);
    }
    $values = [];
    foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) continue;
        [$key, $value] = explode('=', $line, 2);
        $values[trim($key)] = trim(trim($value), "\"'");
    }
    return $values;
}

function jsonBody(): array
{
    $data = json_decode(file_get_contents('php://input') ?: '', true);
    if (!is_array($data)) respond(400, ['error' => 'Corpo JSON inválido.']);
    return $data;
}

function validReport(array $report): bool
{
    return isset($report['startDate'], $report['endDate'], $report['companies'])
        && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$report['startDate']) === 1
        && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$report['endDate']) === 1
        && is_array($report['companies'])
        && count($report['companies']) === 5;
}

function formatReport(array $row): array
{
    $companies = is_array($row['companies']) ? $row['companies'] : json_decode((string)$row['companies'], true, 512, JSON_THROW_ON_ERROR);
    $savedAt = str_replace(' ', 'T', (string)$row['saved_at']);
    return [
        'id' => (int)$row['id'],
        'startDate' => (string)$row['start_date'],
        'endDate' => (string)$row['end_date'],
        'referenceTime' => $row['reference_time'] ? substr((string)$row['reference_time'], 0, 5) : '',
        'companies' => $companies,
        'savedAt' => $savedAt . 'Z'
    ];
}

$env = readEnvFile(__DIR__ . DIRECTORY_SEPARATOR . '.env');
$allowedOrigins = array_filter(array_map('trim', explode(',', $env['WEB_ORIGIN'] ?? 'http://127.0.0.1:5500,http://localhost:5500')));
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Headers: Authorization, Content-Type');
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code($origin === '' || in_array($origin, $allowedOrigins, true) ? 204 : 403);
    exit;
}

$apiToken = trim($env['API_TOKEN'] ?? '');
if ($apiToken !== '') {
    $authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (!hash_equals('Bearer ' . $apiToken, $authorization)) {
        respond(401, ['error' => 'Token de acesso inválido.', 'authRequired' => true]);
    }
}

try {
    $host = $env['MYSQL_HOST'] ?? '127.0.0.1';
    $port = (int)($env['MYSQL_PORT'] ?? 3306);
    $database = $env['MYSQL_DATABASE'] ?? 'levfin';
    $dsn = "mysql:host={$host};port={$port};dbname={$database};charset=utf8mb4";
    $pdo = new PDO($dsn, $env['MYSQL_USER'] ?? '', $env['MYSQL_PASSWORD'] ?? '', [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false
    ]);
    $pdo->exec("SET time_zone = '+00:00'");

    $path = '/' . trim((string)($_GET['path'] ?? ''), '/');
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($path === '/health' && $method === 'GET') {
        $pdo->query('SELECT 1')->fetchColumn();
        respond(200, ['ok' => true, 'database' => 'mysql']);
    }

    if ($path === '/settings/company-names' && $method === 'GET') {
        $stmt = $pdo->prepare('SELECT setting_value FROM settings WHERE setting_key = ?');
        $stmt->execute(['companyNames']);
        $value = $stmt->fetchColumn();
        respond(200, $value === false ? null : json_decode((string)$value, true, 512, JSON_THROW_ON_ERROR));
    }

    if ($path === '/settings/company-names' && $method === 'PUT') {
        $names = jsonBody();
        if (count($names) !== 5 || array_filter($names, fn($name) => !is_string($name) || mb_strlen($name) > 100)) {
            respond(400, ['error' => 'Informe exatamente cinco nomes válidos de empresa.']);
        }
        $stmt = $pdo->prepare('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)');
        $stmt->execute(['companyNames', json_encode(array_values($names), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
        respond(200, array_values($names));
    }

    if ($path === '/reports' && $method === 'GET') {
        $rows = $pdo->query('SELECT id, start_date, end_date, reference_time, companies, saved_at FROM reports ORDER BY saved_at DESC, id DESC')->fetchAll();
        respond(200, array_map('formatReport', $rows));
    }

    if (preg_match('#^/reports/(\d+)$#', $path, $match) === 1) {
        $id = (int)$match[1];
        if ($method === 'GET') {
            $stmt = $pdo->prepare('SELECT id, start_date, end_date, reference_time, companies, saved_at FROM reports WHERE id = ?');
            $stmt->execute([$id]);
            $row = $stmt->fetch();
            if (!$row) respond(404, ['error' => 'Levantamento não encontrado.']);
            respond(200, formatReport($row));
        }
        if ($method === 'PUT') {
            $report = jsonBody();
            if (!validReport($report)) respond(400, ['error' => 'Dados do levantamento inválidos.']);
            $savedAt = gmdate('Y-m-d H:i:s') . sprintf('.%03d', (int)((microtime(true) * 1000) % 1000));
            $stmt = $pdo->prepare('UPDATE reports SET start_date = ?, end_date = ?, reference_time = ?, companies = ?, saved_at = ? WHERE id = ?');
            $stmt->execute([$report['startDate'], $report['endDate'], $report['referenceTime'] ?: null, json_encode($report['companies'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $savedAt, $id]);
            if (!$stmt->rowCount()) {
                $check = $pdo->prepare('SELECT 1 FROM reports WHERE id = ?');
                $check->execute([$id]);
                if (!$check->fetchColumn()) respond(404, ['error' => 'Levantamento não encontrado.']);
            }
            respond(200, [...$report, 'id' => $id, 'savedAt' => str_replace(' ', 'T', $savedAt) . 'Z']);
        }
        if ($method === 'DELETE') {
            $stmt = $pdo->prepare('DELETE FROM reports WHERE id = ?');
            $stmt->execute([$id]);
            if (!$stmt->rowCount()) respond(404, ['error' => 'Levantamento não encontrado.']);
            respond(204);
        }
    }

    if ($path === '/reports' && $method === 'POST') {
        $report = jsonBody();
        if (!validReport($report)) respond(400, ['error' => 'Dados do levantamento inválidos.']);
        $savedAt = gmdate('Y-m-d H:i:s') . sprintf('.%03d', (int)((microtime(true) * 1000) % 1000));
        $stmt = $pdo->prepare('INSERT INTO reports (start_date, end_date, reference_time, companies, saved_at) VALUES (?, ?, ?, ?, ?)');
        $stmt->execute([$report['startDate'], $report['endDate'], $report['referenceTime'] ?: null, json_encode($report['companies'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $savedAt]);
        respond(201, [...$report, 'id' => (int)$pdo->lastInsertId(), 'savedAt' => str_replace(' ', 'T', $savedAt) . 'Z']);
    }

    respond(404, ['error' => 'Rota da API não encontrada.']);
} catch (Throwable $error) {
    error_log('LevFin API: ' . $error->getMessage());
    respond(500, ['error' => 'Falha ao acessar o servidor MySQL. Confira a configuração e o log do Apache.']);
}
