#!/usr/bin/env python3
import sys

content = open("g:\\Meu Drive\\Projetos TADS\\Lev_Fin\\api.php", "r", encoding="utf-8").read()

old = """function validReport(array $report): bool
{
    return isset($report['startDate'], $report['endDate'], $report['companies'])
        && preg_match('/^\\d{4}-\\d{2}-\\d{2}$/', (string)$report['startDate']) === 1
        && preg_match('/^\\d{4}-\\d{2}-\\d{2}$/', (string)$report['endDate']) === 1
        && is_array($report['companies'])
        && count($report['companies']) === 5;
}"""

new = """function validReport(array $report): bool
{
    $companies = $report['companies'] ?? [];
    return isset($report['startDate'], $report['endDate'], $report['companies'])
        && preg_match('/^\\d{4}-\\d{2}-\\d{2}$/', (string)$report['startDate']) === 1
        && preg_match('/^\\d{4}-\\d{2}-\\d{2}$/', (string)$report['endDate']) === 1
        && is_array($companies)
        && count($companies) === 5
        && count(array_filter($companies, fn($name) => is_string($name) && mb_strlen($name) > 0)) === 5;
}"""

if old in content:
    content = content.replace(old, new)
    open("g:\\Meu Drive\\Projetos TADS\\Lev_Fin\\api.php", "w", encoding="utf-8").write(content)
    print("Substituido com sucesso")
else:
    print("Texto antigo nao encontrado")