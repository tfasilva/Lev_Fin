#!/usr/bin/env python3
with open('g:\\Meu Drive\\Projetos TADS\\Lev_Fin\\app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the deleteReport server check
content = content.replace(
    'if (storage === "server") await apiRequest(`/reports/${id}`, "DELETE");\n        else await storeRequest("reports", "readwrite", (store) => store.delete(id));',
    'await storeRequest("reports", "readwrite", (store) => store.delete(id));'
)

# Replace storage === storage with "local" 
content = content.replace(
    'state.draft._storage === storage',
    'state.draft._storage === "local"'
)

with open('g:\\Meu Drive\\Projetos TADS\\Lev_Fin\\app.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done replacing')