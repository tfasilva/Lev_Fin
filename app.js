(() => {
      "use strict";

      const DB_NAME = "levfin-db";
      const DB_VERSION = 1;
      const COMPANY_COUNT = 5;
      const DEFAULT_NAMES = ["ATHENAS", "BOA VISTA", "H&C", "K&K", "TAURUS"];
      const AUTOSAVE_KEY = "levfin_autosave_draft_v2";
      const THEME_KEY = "levfin_theme_v2";
      const STORAGE_KEY = "levfin_storage_config_v1";
      const HISTORY_PASSWORD_KEY = "levfin_history_password_hash_v1";

      const DEFAULT_API_URL = "http://127.0.0.1/levfin-api.php";

      const $ = (id) => document.getElementById(id);

      const state = {
        db: null,
        companies: [],
        activeCompany: 0,
        draft: null,
        noticeTimer: null,
        autoSaveTimer: null,
        ocrWorker: null,
        ocrWorkerPromise: null,
        importRows: [],
        importCompanyIndex: 0,
        filterText: "",
        paymentStatusFilter: "all",
        paymentSort: "date-asc",
        ocrFilterText: "",
        ocrSort: "date-asc",
        storageMode: "auto", // "auto", "server", "local"
        apiUrl: DEFAULT_API_URL,
        apiToken: "",
        serverConnected: false,
        historyUnlocked: false
      };

      function loadStorageConfig() {
        try {
          const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
          state.storageMode = ["auto", "server", "local"].includes(saved.mode) ? saved.mode : "auto";
          state.apiUrl = saved.apiUrl || DEFAULT_API_URL;
          state.apiToken = saved.apiToken || "";
        } catch (_) {
          state.storageMode = "auto";
          state.apiUrl = DEFAULT_API_URL;
        }

        if ($("storageMode")) $("storageMode").value = state.storageMode;
        if ($("apiUrlInput")) $("apiUrlInput").value = state.apiUrl;
        if ($("apiTokenInput")) $("apiTokenInput").value = state.apiToken;
        updateStorageUiLabels();
      }

      function saveStorageConfig() {
        state.storageMode = $("storageMode").value;
        state.apiUrl = $("apiUrlInput").value.trim() || DEFAULT_API_URL;
        state.apiToken = $("apiTokenInput").value.trim();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: state.storageMode, apiUrl: state.apiUrl, apiToken: state.apiToken }));
        updateStorageUiLabels();
      }

      function updateStorageUiLabels() {
        const toggleBtn = $("toggleConnectButton");
        if (toggleBtn) {
          if (state.storageMode === "local") {
            toggleBtn.textContent = "⚡ Ativar Modo Servidor";
          } else {
            toggleBtn.textContent = "🔌 Usar Somente Offline (Local)";
          }
        }
        const powerSwitch = $("serverPowerSwitch");
        if (powerSwitch) {
          powerSwitch.checked = state.storageMode !== "local";
        }
      }

      function setStorageStatus(kind, text) {
        if ($("dbStatus")) $("dbStatus").textContent = text;
        const dot = $("dbDot");
        if (dot) {
          dot.classList.toggle("ready", kind === "server");
          dot.classList.toggle("offline", kind === "local");
          dot.classList.toggle("error", kind === "error");
        }
      }

      function apiEndpoint(path) {
        const base = state.apiUrl || DEFAULT_API_URL;
        const url = new URL(base, document.baseURI);
        url.searchParams.set("path", path);
        return url.href;
      }

      async function apiRequest(path, method = "GET", body) {
        const headers = { "Accept": "application/json" };
        if (body !== undefined) headers["Content-Type"] = "application/json";
        if (state.apiToken) headers.Authorization = `Bearer ${state.apiToken}`;
        const response = await fetch(apiEndpoint(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        if (!response.ok) {
          let detail = "";
          try { detail = (await response.json()).error || ""; } catch (_) {}
          throw new Error(detail || `Servidor respondeu status ${response.status}.`);
        }
        return response.status === 204 ? null : response.json();
      }

      async function checkServerConnection(showMessage = false) {
        if (state.storageMode === "local") {
          state.serverConnected = false;
          setStorageStatus("local", "Modo Local (Navegador)");
          if (showMessage) notify("Modo 100% local ativo. Os dados ficam salvos apenas neste navegador.");
          return false;
        }

        try {
          await apiRequest("/health");
          state.serverConnected = true;
          setStorageStatus("server", "Servidor MySQL conectado");
          if (showMessage) notify("Conexão com o banco de dados MySQL realizada com sucesso!");
          return true;
        } catch (error) {
          state.serverConnected = false;
          if (state.storageMode === "server") {
            setStorageStatus("error", "Erro ao conectar no MySQL");
            if (showMessage) notify(`Falha ao conectar no servidor MySQL: ${error.message}`, true);
          } else {
            setStorageStatus("offline", "Servidor offline · usando navegador");
            if (showMessage) notify(`Servidor indisponível. Alternando para o banco local do navegador. (${error.message})`, true);
          }
          return false;
        }
      }

      function todayISO() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      }

      function newDraft() {
        return {
          id: null,
          startDate: todayISO(),
          endDate: todayISO(),
          referenceTime: new Date().toTimeString().slice(0, 5),
          companies: state.companies.map((name) => ({ name, balance: 0, payments: [] }))
        };
      }

      /* Banco de Dados Local IndexedDB */
      function openDatabase() {
        return new Promise((resolve, reject) => {
          if (!("indexedDB" in window)) {
            reject(new Error("Este navegador não oferece suporte ao banco local IndexedDB."));
            return;
          }
          const request = indexedDB.open(DB_NAME, DB_VERSION);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains("reports")) {
              const reports = db.createObjectStore("reports", { keyPath: "id", autoIncrement: true });
              reports.createIndex("savedAt", "savedAt", { unique: false });
            }
            if (!db.objectStoreNames.contains("settings")) {
              db.createObjectStore("settings", { keyPath: "key" });
            }
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error("Não foi possível abrir o banco local."));
          request.onblocked = () => reject(new Error("O banco local está bloqueado por outra aba. Feche outras abas e tente novamente."));
        });
      }

      function storeRequest(storeName, mode, action) {
        return new Promise((resolve, reject) => {
          if (!state.db) {
            reject(new Error("Banco de dados ainda não inicializado."));
            return;
          }
          const transaction = state.db.transaction(storeName, mode);
          const request = action(transaction.objectStore(storeName));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error("A operação no banco local falhou."));
          transaction.onabort = () => reject(transaction.error || new Error("A transação foi cancelada."));
        });
      }

      /* Notificações Toast */
      function notify(message, error = false) {
        const box = $("notice");
        box.textContent = message;
        box.classList.toggle("error", error);
        box.classList.remove("hidden");
        clearTimeout(state.noticeTimer);
        state.noticeTimer = setTimeout(() => box.classList.add("hidden"), 4000);
      }

      function showError(error) {
        console.error(error);
        notify(error instanceof Error ? error.message : "Ocorreu um erro inesperado.", true);
      }

      function hasHistoryPassword() {
        return Boolean(localStorage.getItem(HISTORY_PASSWORD_KEY));
      }

      async function hashHistoryPassword(password) {
        if (!window.crypto || !window.crypto.subtle) {
          throw new Error("Este navegador não oferece criptografia segura para proteger o histórico.");
        }
        const data = new TextEncoder().encode(password);
        const digest = await window.crypto.subtle.digest("SHA-256", data);
        return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      }

      async function setHistoryPassword() {
        const password = $("historyPasswordInput").value;
        const confirmation = $("historyPasswordConfirm").value;
        if (password.length < 6) throw new Error("A senha do histórico deve ter pelo menos 6 caracteres.");
        if (password !== confirmation) throw new Error("A confirmação da senha não confere.");
        localStorage.setItem(HISTORY_PASSWORD_KEY, await hashHistoryPassword(password));
        state.historyUnlocked = true;
        $("historyPasswordInput").value = "";
        $("historyPasswordConfirm").value = "";
        await renderHistory();
        notify("Senha do histórico configurada. O histórico está desbloqueado nesta sessão.");
      }

      async function unlockHistory() {
        if (!hasHistoryPassword()) {
          $("settingsDetails").open = true;
          notify("Defina uma senha nas configurações antes de acessar o histórico.", true);
          return;
        }
        const password = window.prompt("Informe a senha para visualizar os levantamentos salvos:");
        if (password === null) return;
        const passwordHash = await hashHistoryPassword(password);
        if (passwordHash !== localStorage.getItem(HISTORY_PASSWORD_KEY)) {
          throw new Error("Senha do histórico inválida.");
        }
        state.historyUnlocked = true;
        await renderHistory();
        notify("Histórico desbloqueado nesta sessão.");
      }

      function lockHistory() {
        state.historyUnlocked = false;
        renderHistory().catch(showError);
        notify("Histórico bloqueado.");
      }

      function requireHistoryAccess() {
        if (!hasHistoryPassword()) {
          $("settingsDetails").open = true;
          throw new Error("Defina uma senha do histórico nas configurações.");
        }
        if (!state.historyUnlocked) {
          throw new Error("Desbloqueie o histórico antes de continuar.");
        }
      }

      function escapeHTML(value) {
        if (value === null || value === undefined) return "";
        return String(value).replace(/[&<>"']/g, (character) => ({
          "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[character]);
      }

      function dateBR(isoDate) {
        if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return "—";
        const [year, month, day] = isoDate.split("-");
        return `${day}/${month}/${year}`;
      }

      function dateShort(isoDate) {
        if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return "—";
        const [year, month, day] = isoDate.split("-");
        return `${day}.${month}.${year}`;
      }

      /* Formatação de Moeda Brasileira */
      function formatCurrencyBR(value) {
        if (value === null || value === undefined || value === "" || isNaN(value)) {
          return "R$ 0,00";
        }
        const num = Number(value);
        const isNegative = num < 0;
        const absVal = Math.abs(num);
        const parts = absVal.toFixed(2).split(".");
        const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
        const decPart = parts[1];
        return `R$ ${isNegative ? "-" : ""}${intPart},${decPart}`;
      }

      function formatPaymentAmount(value) {
        return value === "" || value === null || value === undefined ? "" : formatCurrencyBR(Number(value) || 0);
      }

      function parsePaymentAmount(value) {
        const text = String(value || "").trim();
        if (!text) return "";
        if (/R\$|,/.test(text) || /^\d{1,3}(?:\.\d{3})+$/.test(text)) return parseBrazilianAmount(text);
        const parsed = Number(text);
        return Number.isFinite(parsed) ? parsed : "";
      }

      /* Cálculos Financeiros */
      function paymentTotals(company) {
        const payments = company.payments || [];
        return payments.reduce((totals, payment) => {
          const amount = Number(payment.amount) || 0;
          totals.payable += amount;
          if (payment.status === "paid") {
            totals.paid += amount;
            totals.authorizedOrPaid += amount;
          } else if (payment.status === "authorized") {
            totals.authorized += amount;
            totals.authorizedOrPaid += amount;
          } else {
            // "pending" ou "confirmation"
            totals.pending += amount;
            totals.forecastOutflow += amount;
          }
          return totals;
        }, { payable: 0, paid: 0, authorized: 0, authorizedOrPaid: 0, pending: 0, forecastOutflow: 0 });
      }

      function paymentRemittanceType(payment) {
        if (["pix", "standard", "manual", "gestao"].includes(payment.remittanceType)) return payment.remittanceType;
        if (/remessa\s*_?\s*pix/i.test(payment.remittance || "")) return "pix";
        if (/gestao|gestão/i.test(payment.remittance || "")) return "gestao";
        if (/remessa/i.test(payment.remittance || "")) return "standard";
        return "manual";
      }

      function paymentRemittanceDate(payment) {
        if (payment.remittanceDate) return payment.remittanceDate;
        const legacyDate = String(payment.remittance || "").match(/(\d{2})[./-](\d{2})[./-](\d{4})/);
        if (legacyDate) return `${legacyDate[3]}-${legacyDate[2]}-${legacyDate[1]}`;
        const isoDate = String(payment.remittance || "").match(/(\d{4})-(\d{2})-(\d{2})/);
        return isoDate ? isoDate[0] : "";
      }

      function remittanceLabel(payment) {
        const type = paymentRemittanceType(payment);
        if (type === "manual") return "Lançamento manual";
        if (type === "gestao") return "Lançamento Gestão";
        const date = paymentRemittanceDate(payment);
        return `${type === "pix" ? "Remessa PIX" : "Remessa"}${date ? ` - ${dateShort(date)}` : ""}`;
      }

      /* Salvamento Automático de Rascunho no localStorage */
      function scheduleAutoSave() {
        clearTimeout(state.autoSaveTimer);
        state.autoSaveTimer = setTimeout(() => {
          try {
            readMetadata();
            localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state.draft));
            const now = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
            $("autoSaveIndicator").textContent = `⚡ Salvo às ${now}`;
          } catch (e) {
            console.warn("Falha no auto-save:", e);
          }
        }, 600);
      }

      function loadAutoSavedDraft() {
        try {
          const raw = localStorage.getItem(AUTOSAVE_KEY);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.companies)) return parsed;
        } catch (e) {
          console.warn("Falha ao recuperar rascunho salvo:", e);
        }
        return null;
      }

      /* Processamento OCR */
      function normalizeText(value) {
        return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      }

      function parseBrazilianDate(value) {
        const match = value.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
        if (!match) return "";
        const [, day, month, year] = match;
        const date = new Date(Number(year), Number(month) - 1, Number(day));
        if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return "";
        return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
      }

      function parseBrazilianAmount(value) {
        const normalized = value.replace(/[Oo]/g, "0").replace(/[lI]/g, "1").replace(/R\$/gi, "").replace(/\s/g, "");
        const commaDecimal = normalized.match(/^-?\d[\d.]*,\d{1,2}$/);
        if (commaDecimal) return Number(commaDecimal[0].replace(/\./g, "").replace(",", "."));
        const dotDecimal = normalized.match(/^-?\d+\.\d{1,2}$/);
        if (dotDecimal) return Number(dotDecimal[0]);
        const groupedInteger = normalized.match(/^-?\d{1,3}(?:\.\d{3})+$/);
        if (groupedInteger) return Number(groupedInteger[0].replace(/\./g, ""));
        const digits = normalized.replace(/\D/g, "");
        if (!digits) return null;
        const amount = Number(digits) / 100;
        return normalized.trim().startsWith("-") ? -amount : amount;
      }

      function updatePeriodFromOcrRows(rows) {
        const dates = rows
          .map((row) => row.dueDate)
          .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
          .sort();
        if (!dates.length) return false;

        const existingDates = state.draft.companies
          .flatMap((company) => (company.payments || []).map((payment) => payment.dueDate))
          .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
          .sort();
        const allDates = [...existingDates, ...dates].sort();
        const startDate = allDates[0];
        const endDate = allDates[allDates.length - 1];

        state.draft.startDate = startDate;
        state.draft.endDate = endDate;
        $("startDate").value = startDate;
        $("endDate").value = endDate;
        return true;
      }
      function parseReviewAmount(value) {
        const text = String(value).trim().replace(/R\$\s?/gi, '').replace(/\s/g, '');
        if (!text) return null;
        if (text.includes(',')) return Number(text.replace(/\./g, '').replace(',', '.'));
        if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) return Number(text.replace(/\./g, ''));
        return Number(text);
      }

      function formatReviewAmount(value) {
        if (value === '' || value === null || !Number.isFinite(Number(value))) return '';
        return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
      }

      function statusFromBadgeColor(context, rowCenterY, imageWidth, imageHeight, xStart = 0, xEnd = 0.16) {
        const x0 = Math.max(0, Math.round(imageWidth * xStart));
        const x1 = Math.min(imageWidth, Math.round(imageWidth * xEnd));
        const yRadius = Math.max(6, Math.round(imageHeight * 0.018));
        const yStart = Math.max(0, Math.round(rowCenterY) - yRadius);
        const yEnd = Math.min(imageHeight, Math.round(rowCenterY) + yRadius);
        const pixels = context.getImageData(x0, yStart, x1 - x0, yEnd - yStart).data;
        let green = 0;
        let amber = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          const red = pixels[index];
          const channelGreen = pixels[index + 1];
          const blue = pixels[index + 2];
          if (channelGreen > red * 1.25 && channelGreen > blue * 1.15 && channelGreen > 70) green++;
          else if (red > channelGreen * 1.15 && channelGreen > blue * 1.2 && red > 140) amber++;
        }
        if (green > 20 || amber > 20) return green > amber ? "paid" : "pending";
        return "";
      }

      function ocrHeaderField(text) {
        const token = normalizeText(text).replace(/[^a-z0-9]/g, "");
        if (/^situac/.test(token)) return "status";
        if (/^criad/.test(token)) return "createdBy";
        if (/^vencim/.test(token)) return "dueDate";
        if (/^plano/.test(token)) return "plan";
        if (/^centro/.test(token) || /^ccusto/.test(token)) return "costCenter";
        if (/^fornecedor/.test(token)) return "supplier";
        if (/^valor/.test(token)) return "amount";
        if (/^histor/.test(token)) return "history";
        if (/^(numero|numer|num|id)$/.test(token)) return "number";
        return "";
      }

      function groupOcrWordsIntoLines(words) {
        if (!words.length) return [];
        const centerY = (word) => (word.bbox.y0 + word.bbox.y1) / 2;
        const heights = words.map((word) => Math.max(1, word.bbox.y1 - word.bbox.y0)).sort((a, b) => a - b);
        const lineTolerance = Math.max(5, heights[Math.floor(heights.length / 2)] * 0.72);
        const lines = [];
        [...words].sort((a, b) => centerY(a) - centerY(b)).forEach((word) => {
          const y = centerY(word);
          let line = lines.slice(-3).find((candidate) => Math.abs(candidate.centerY - y) <= lineTolerance);
          if (!line) {
            line = { centerY: y, words: [] };
            lines.push(line);
          }
          line.words.push(word);
          line.centerY = line.words.reduce((sum, item) => sum + centerY(item), 0) / line.words.length;
        });
        return lines.sort((a, b) => a.centerY - b.centerY);
      }

      function parseOcrRows(words, imageWidth, imageHeight, imageContext) {
        if (!Array.isArray(words) || !words.length) return [];
        const positioned = words.filter((word) => word.text && word.bbox && Number.isFinite(word.bbox.y0) && Number.isFinite(word.bbox.x0));
        const lines = groupOcrWordsIntoLines(positioned);
        const headerCandidates = lines.filter((line) => line.centerY < imageHeight * 0.3).map((line) => {
          const fields = {};
          line.words.forEach((word) => {
            const field = ocrHeaderField(word.text);
            if (field && !fields[field]) fields[field] = { left: word.bbox.x0, right: word.bbox.x1, x: (word.bbox.x0 + word.bbox.x1) / 2 };
          });
          return { ...line, fields, score: Object.keys(fields).length };
        }).sort((a, b) => b.score - a.score);
        const header = headerCandidates[0];
        if (!header || !header.fields.dueDate || !header.fields.amount) return [];

        const columns = Object.entries(header.fields).map(([field, position]) => ({ field, ...position })).sort((a, b) => a.x - b.x);
        const bounds = {};
        columns.forEach((column, index) => {
          bounds[column.field] = {
            left: index === 0 ? 0 : Math.max(0, column.left - 3),
            right: index === columns.length - 1 ? imageWidth : Math.min(imageWidth, columns[index + 1].left - 3)
          };
        });
        const wordsInColumn = (sourceWords, field) => {
          const range = bounds[field];
          if (!range) return [];
          return sourceWords.filter((word) => {
            const centerX = (word.bbox.x0 + word.bbox.x1) / 2;
            return centerX >= range.left && centerX < range.right;
          }).sort((a, b) => a.bbox.x0 - b.bbox.x0);
        };
        const columnText = (sourceWords, field) => wordsInColumn(sourceWords, field).map((word) => word.text).join(" ").trim();
        const statusFromText = (value) => {
          const text = normalizeText(value);
          if (/confirm|aguard.*pag/.test(text)) return "confirmation";
          if (/a\s*pagar|pendente|aberto|previsao/.test(text)) return "pending";
          if (/\bpaga\b|\bpago\b|quitad/.test(text)) return "paid";
          if (/autorizad/.test(text)) return "authorized";
          return "";
        };

        // Combine anchors from every recognized data column. A weak OCR result in one
        // column must not make us lose rows that another column read correctly.
        const anchorWords = positioned.filter((word) => {
          const y = (word.bbox.y0 + word.bbox.y1) / 2;
          if (y <= header.centerY) return false;
          return ['amount', 'dueDate', 'status'].some((field) => {
            if (!bounds[field]) return false;
            const text = columnText([word], field);
            return field === 'amount' ? parseBrazilianAmount(text) !== null
              : field === 'dueDate' ? Boolean(parseBrazilianDate(text))
              : Boolean(statusFromText(text));
          });
        });
        let anchors = groupOcrWordsIntoLines(anchorWords);
        if (anchors.length) {
          const anchorHeights = anchorWords.map((word) => Math.max(1, word.bbox.y1 - word.bbox.y0)).sort((a, b) => a - b);
          const mergeDistance = Math.max(4, (anchorHeights[Math.floor(anchorHeights.length / 2)] || 8) * 0.8);
          const merged = [];
          anchors.forEach((anchor) => {
            const previous = merged[merged.length - 1];
            if (previous && anchor.centerY - previous.centerY <= mergeDistance) {
              previous.words.push(...anchor.words);
              previous.centerY = previous.words.reduce((sum, word) => sum + (word.bbox.y0 + word.bbox.y1) / 2, 0) / previous.words.length;
            } else merged.push({ centerY: anchor.centerY, words: [...anchor.words] });
          });
          anchors = merged;
        }

        let rowLines;
        if (anchors.length) {
          rowLines = anchors.map((anchor, index) => {
            const previous = anchors[index - 1];
            const next = anchors[index + 1];
            const beforeGap = previous ? anchor.centerY - previous.centerY : (next ? next.centerY - anchor.centerY : imageHeight);
            const afterGap = next ? next.centerY - anchor.centerY : beforeGap;
            const top = previous ? (previous.centerY + anchor.centerY) / 2 : Math.max(header.centerY, anchor.centerY - beforeGap / 2);
            const bottom = next ? (anchor.centerY + next.centerY) / 2 : Math.min(imageHeight, anchor.centerY + afterGap / 2);
            return { centerY: anchor.centerY, top, bottom, words: positioned.filter((word) => {
              const y = (word.bbox.y0 + word.bbox.y1) / 2;
              return y >= top && y < bottom;
            }) };
          });
        } else {
          rowLines = lines.filter((line) => line.centerY > header.centerY + 2).map((line, index, all) => {
            const previous = all[index - 1], next = all[index + 1];
            const before = previous ? line.centerY - previous.centerY : (next ? next.centerY - line.centerY : 24);
            const after = next ? next.centerY - line.centerY : before;
            return { ...line, top: previous ? (previous.centerY + line.centerY) / 2 : line.centerY - before / 2, bottom: next ? (line.centerY + next.centerY) / 2 : line.centerY + after / 2 };
          });
        }

        const descriptions = ["supplier", "history"];
        return rowLines.map((line) => {
          const ordered = line.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
          const dueDateText = columnText(ordered, "dueDate");
          const amountText = columnText(ordered, "amount");
          const dueDate = parseBrazilianDate(dueDateText);
          const amount = parseBrazilianAmount(amountText);
          const statusText = columnText(ordered, "status");
          const statusColumn = bounds.status;
          const detectedStatus = statusFromText(statusText) || (statusColumn ? statusFromBadgeColor(imageContext, line.centerY, imageWidth, imageHeight, statusColumn.left / imageWidth, statusColumn.right / imageWidth) : "");
          const status = detectedStatus === "paid" ? "paid" : "";
          const description = descriptions.map((field) => columnText(ordered, field)).filter(Boolean).join(" | ");
          if (!dueDate && amount === null && !statusText && !description) return null;

          const amountOcrWords = wordsInColumn(ordered, "amount");
          const amountConfidence = amountOcrWords.length ? Math.round(amountOcrWords.reduce((sum, word) => sum + (Number(word.confidence) || 0), 0) / amountOcrWords.length) : 0;
          const criticalFields = ["dueDate", "amount", "supplier", "history"].filter((field) => bounds[field]);
          const criticalWords = criticalFields.flatMap((field) => wordsInColumn(ordered, field));
          const confidenceWords = criticalWords.length ? criticalWords : ordered;
          const confidence = confidenceWords.length ? Math.round(confidenceWords.reduce((sum, word) => sum + (Number(word.confidence) || 0), 0) / confidenceWords.length) : 45;
          const missingRequiredFields = Number(!dueDate) + Number(amount === null) + Number(Boolean(bounds.supplier) && !columnText(ordered, "supplier")) + Number(Boolean(bounds.history) && !columnText(ordered, "history"));
          return {
            dueDate,
            amount: amount === null ? "" : Math.round(amount * 100) / 100,
            description: description.slice(0, 600),
            status,
            remittanceType: "",
            remittanceDate: "",
            ocrY: line.centerY,
            ocrCrop: { amountLeft: bounds.amount.left, amountRight: bounds.amount.right, top: line.top, bottom: line.bottom, imageWidth },
            ocrAmountText: amountText,
            amountConfidence,
            ocrAmountMissing: amount === null,
            confidence: Math.max(25, confidence - missingRequiredFields * 25)
          };
        }).filter(Boolean);
      }
      function chooseMoreReliableRows(firstRows, secondRows) {
        if (!firstRows.length) return secondRows;
        if (!secondRows.length) return firstRows;
        if (secondRows.length !== firstRows.length) return secondRows.length > firstRows.length ? secondRows : firstRows;
        return firstRows.map((first, index) => {
          const second = secondRows[index];
          const best = second.confidence > first.confidence ? second : first;
          const other = best === first ? second : first;
          const dueDate = best.dueDate || other.dueDate;
          const amount = best.amount !== "" ? best.amount : other.amount;
          const description = best.description || other.description;
          const status = best.status || other.status;
          const recoveredFields = Number(!best.dueDate && Boolean(other.dueDate))
            + Number(best.amount === "" && other.amount !== "")
            + Number(!best.description && Boolean(other.description))
            + Number(!best.status && Boolean(other.status));
          const confidence = Math.max(best.confidence, other.confidence) - recoveredFields * 5;
          return {
            ...best,
            dueDate,
            amount,
            description,
            status,
            confidence: Math.max(25, Math.min(100, confidence)),
            ocrAmountMissing: amount === ""
          };
        });
      }
      async function refineOcrAmounts(rows, sourceCanvas, worker) {
        for (let index = 0; index < rows.length; index++) {
          const row = rows[index], crop = row.ocrCrop;
          $("ocrStatus").textContent = `Conferindo linha ${index + 1} de ${rows.length}...`;
          if (!crop || !Number.isFinite(crop.top) || !Number.isFinite(crop.bottom)) continue;
          const padY = Math.max(2, Math.round((crop.bottom - crop.top) * 0.12));
          const sy = Math.max(0, Math.floor(crop.top - padY));
          const bottom = Math.min(sourceCanvas.height, Math.ceil(crop.bottom + padY));
          const sh = bottom - sy;
          if (sh < 2) continue;
          const rowCanvas = document.createElement("canvas");
          rowCanvas.width = sourceCanvas.width; rowCanvas.height = sh;
          rowCanvas.getContext("2d").drawImage(sourceCanvas, 0, sy, sourceCanvas.width, sh, 0, 0, rowCanvas.width, rowCanvas.height);
          try {
            const result = await worker.recognize(rowCanvas, { tessedit_pageseg_mode: "7" }, { blocks: true });
            const amountWords = (result.data.words || []).filter((word) => {
              if (!word.text || !word.bbox) return false;
              const centerX = ((word.bbox.x0 + word.bbox.x1) / 2) / 2;
              return centerX >= crop.amountLeft && centerX < crop.amountRight;
            }).sort((a, b) => a.bbox.x0 - b.bbox.x0);
            const amountText = amountWords.map((word) => word.text).join(" ").trim();
            const candidate = parseBrazilianAmount(amountText);
            if (candidate === null || !Number.isFinite(candidate)) continue;
            const confidence = amountWords.length ? Math.round(amountWords.reduce((sum, word) => sum + (Number(word.confidence) || 0), 0) / amountWords.length) : 0;
            if (confidence < 40) continue;
            const previous = Number(row.amount);
            if (row.amount === "" || !Number.isFinite(previous)) {
              row.amount = Math.round(candidate * 100) / 100;
              row.confidence = Math.min(100, row.confidence + (row.ocrAmountMissing ? 25 : 0));
              row.ocrAmountMissing = false;
            } else if (Math.abs(previous - candidate) <= 0.01) {
              row.amount = Math.round(candidate * 100) / 100;
            } else if (confidence >= row.amountConfidence + 6) {
              row.amount = Math.round(candidate * 100) / 100;
              row.amountConfidence = confidence;
            } else if (row.amountConfidence >= confidence + 6) {
              // Keep the full-table value when its amount cell was read more clearly.
            } else {
              row.ocrAmountOriginal = previous;
              row.ocrAmountSuggestion = candidate;
              row.amount = "";
              row.confidence = Math.min(row.confidence, 60);
              row.amountConflict = true;
            }
          } catch (error) { console.warn("A releitura da linha falhou; mantendo os valores reconhecidos na tabela.", error); }
        }
        return rows;
      }
      function loadOcrLibrary() {
        if (window.Tesseract) return Promise.resolve(window.Tesseract);
        return new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
          script.async = true;
          script.onload = () => {
            if (window.Tesseract) resolve(window.Tesseract);
            else reject(new Error("O mecanismo de leitura da imagem não foi carregado corretamente."));
          };
          script.onerror = () => reject(new Error("Não foi possível carregar o OCR. Verifique a conexão à internet e tente novamente."));
          document.head.appendChild(script);
        });
      }

      async function getOcrWorker() {
        if (state.ocrWorker) return state.ocrWorker;
        if (!state.ocrWorkerPromise) {
          state.ocrWorkerPromise = loadOcrLibrary().then((tesseract) => tesseract.createWorker("por", 1, {
            gzip: false,
            workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
            corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0",
            langPath: new URL("./", document.baseURI).href,
            logger: (progress) => {
              if (!progress || !Number.isFinite(progress.progress)) return;
              $("ocrProgress").value = progress.progress;
              $("ocrStatus").textContent = progress.status === "recognizing text"
                ? `Lendo imagem… ${Math.round(progress.progress * 100)}%`
                : "Preparando OCR em português…";
            }
          })).then((worker) => {
            state.ocrWorker = worker;
            return worker;
          }).catch((error) => {
            state.ocrWorkerPromise = null;
            throw error;
          });
        }
        return state.ocrWorkerPromise;
      }

      async function processScreenshot(file) {
        if (!file || !file.type.startsWith("image/")) throw new Error("Selecione um arquivo de imagem válido.");
        if (file.size > 20 * 1024 * 1024) throw new Error("A imagem deve ter até 20 MB.");
        state.importCompanyIndex = state.activeCompany;
        state.importRows = [];
        $("ocrReview").classList.add("hidden");
        $("ocrProgress").classList.remove("hidden");
        $("ocrProgress").value = 0;
        $("selectScreenshotButton").disabled = true;
        $("ocrStatus").textContent = "Abrindo print…";

        let bitmap;
        try {
          bitmap = await createImageBitmap(file);
          const requestedScale = Math.min(3, Math.max(1.7, 3000 / bitmap.width));
          const pixelLimitScale = Math.sqrt(12000000 / (bitmap.width * bitmap.height));
          const scale = Math.min(requestedScale, pixelLimitScale);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(bitmap.width * scale);
          canvas.height = Math.round(bitmap.height * scale);
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) throw new Error("Não foi possível preparar a imagem para leitura.");
          context.fillStyle = "#fff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          context.filter = "contrast(1.12)";
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          context.filter = "none";
          bitmap.close();
          bitmap = null;

          const worker = await getOcrWorker();
          $("ocrStatus").textContent = "Identificando colunas e linhas financeiras…";
          const result = await worker.recognize(canvas, {}, { blocks: true });
          const words = result.data.words || [];
          state.importRows = parseOcrRows(words, canvas.width, canvas.height, context);
          const needsSecondPass = !state.importRows.length || state.importRows.some((row) => !row.dueDate || row.amount === "" || !row.description);
          if (needsSecondPass) {
            $("ocrStatus").textContent = "Conferindo campos não reconhecidos…";
            const secondPass = await worker.recognize(canvas, { tessedit_pageseg_mode: "6" }, { blocks: true });
            const secondRows = parseOcrRows(secondPass.data.words || [], canvas.width, canvas.height, context);
            state.importRows = chooseMoreReliableRows(state.importRows, secondRows);
          }
          state.importRows = await refineOcrAmounts(state.importRows, canvas, worker);
          const periodUpdated = updatePeriodFromOcrRows(state.importRows);
          if (!state.importRows.length) {
            const recognizedText = (result.data.text || "").slice(0, 250).trim();
            throw new Error(`Não consegui associar as linhas aos títulos das colunas. Confira se o print inclui os cabeçalhos Vencimento e Valor e se as linhas estão legíveis.${recognizedText ? ` Texto lido: ${recognizedText}` : ""}`);
          }
          renderOcrPreview();
          $("ocrReview").classList.remove("hidden");
          const companyName = state.draft.companies[state.importCompanyIndex].name;
          $("ocrStatus").textContent = `${state.importRows.length} lançamento(s) lido(s) para ${companyName}.${periodUpdated ? ` Período ajustado para ${dateBR(state.draft.startDate)} a ${dateBR(state.draft.endDate)}.` : ""}`;
          updateWhatsAppPreview();
          scheduleAutoSave();
        } finally {
          if (bitmap) bitmap.close();
          $("ocrProgress").classList.add("hidden");
          $("selectScreenshotButton").disabled = false;
          $("screenshotInput").value = "";
        }
      }

      function renderOcrPreview() {
        const term = normalizeText(state.ocrFilterText);
        const visibleRows = state.importRows
          .map((row, originalIndex) => ({ row, originalIndex }))
          .filter(({ row }) => !term || normalizeText(`${row.description || ""} ${row.dueDate || ""} ${row.amount || ""}`).includes(term))
          .sort((a, b) => sortRows(a.row, b.row, state.ocrSort));

        $("ocrRows").innerHTML = visibleRows.map(({ row, originalIndex }, displayIndex) => {
          const confidence = row.confidence < 75 ? "Leitura baixa — confira com atenção" : `Confiança ${row.confidence}%`;
          const confidenceClass = row.confidence < 75 ? "import-confidence low" : "import-confidence";
          const isDateHidden = !row.remittanceType || row.remittanceType === "manual" || row.remittanceType === "gestao";
          return `<article class="import-row" data-import-row="${originalIndex}">
            <div class="import-row-heading">
              <span>Lançamento ${displayIndex + 1}</span>
              <div class="import-row-heading-actions">
                <span class="${confidenceClass}">${confidence}</span>
                <button class="action-btn-sm delete" type="button" data-import-remove="${originalIndex}" title="Excluir este lançamento" aria-label="Excluir lançamento ${displayIndex + 1}">✕</button>
              </div>
            </div>
            <div class="import-fields">
              <div>
                <label>Vencimento</label>
                <input type="date" class="${row.dueDate ? "" : "ocr-field-missing"}" data-import-field="dueDate" value="${escapeHTML(row.dueDate)}">
              </div>
              <div>
                <label>Valor (R$)</label>
                ${row.amountConflict ? `<small class="import-conflict-hint">Tabela: ${escapeHTML(formatReviewAmount(row.ocrAmountOriginal))} | releitura: ${escapeHTML(formatReviewAmount(row.ocrAmountSuggestion))}</small>` : ""}
                <input type="text" inputmode="decimal" class="${row.amount === "" ? "ocr-field-missing" : ""}" data-import-field="amount" value="${escapeHTML(formatReviewAmount(row.amount))}">
              </div>
              <div class="wide">
                <label>Fornecedor / Histórico</label>
                <input type="text" maxlength="600" class="${row.description ? "" : "ocr-field-missing"}" data-import-field="description" value="${escapeHTML(row.description)}">
              </div>
              <div>
                <label>Situação</label>
                <select data-import-field="status" class="${row.status ? "" : "ocr-field-missing"}">
                  <option value=""${!row.status ? " selected" : ""}>\u26a0\ufe0f Confirme a situa\u00e7\u00e3o</option>
                  <option value="pending"${row.status === "pending" ? " selected" : ""}>✴️ A Autorizar (Pendente)</option>
                  <option value="authorized"${row.status === "authorized" ? " selected" : ""}>✳️ Autorizado</option>
                  <option value="paid"${row.status === "paid" ? " selected" : ""}>✅ Pago</option>
                  <option value="confirmation"${row.status === "confirmation" ? " selected" : ""}>⚠️ Confirmação de Pagamento</option>
                </select>
              </div>
              <div>
                <label>Método no Banco</label>
                <select data-import-field="remittanceType" class="${row.remittanceType ? "" : "ocr-field-missing"}">
                  <option value=""${!row.remittanceType ? " selected" : ""}>\u26a0\ufe0f Selecione o m\u00e9todo</option>
                  <option value="standard"${row.remittanceType === "standard" ? " selected" : ""}>✉️ Remessa</option>
                  <option value="pix"${row.remittanceType === "pix" ? " selected" : ""}>✉️ Remessa_PIX</option>
                  <option value="manual"${row.remittanceType === "manual" ? " selected" : ""}>📝 Lançamento Manual</option>
                  <option value="gestao"${row.remittanceType === "gestao" ? " selected" : ""}>📝 Lançamento Gestão</option>
                </select>
              </div>
              <div data-remittance-date="${originalIndex}"${isDateHidden ? ' class="hidden"' : ""}>
                <label>Data da Remessa</label>
                <input type="date" class="${row.remittanceDate ? "" : "ocr-field-missing"}" data-import-field="remittanceDate" value="${escapeHTML(row.remittanceDate)}">
              </div>
            </div>
          </article>`;
        }).join("");

        renderOcrSummary();
        if (!visibleRows.length) {
          $("ocrRows").innerHTML = '<div class="table-empty">Nenhum lançamento corresponde ao filtro.</div>';
        }
        $("ocrRows").querySelectorAll("[data-import-remove]").forEach((button) => {
          button.addEventListener("click", () => {
            const index = Number(button.dataset.importRemove);
            state.importRows.splice(index, 1);
            renderOcrPreview();
            if (!state.importRows.length) {
              $("ocrReview").classList.add("hidden");
              $("ocrStatus").textContent = "Todos os lançamentos da leitura foram removidos.";
            }

          });
        });

        $("ocrRows").querySelectorAll("[data-import-field]").forEach((input) => {
          const update = () => {
            const card = input.closest("[data-import-row]");
            const index = Number(card.dataset.importRow);
            const field = input.dataset.importField;
            if (field === "amount") {
              const parsedAmount = parseReviewAmount(input.value);
              state.importRows[index].amount = input.value.trim() === "" ? "" : (parsedAmount !== null && Number.isFinite(parsedAmount) ? parsedAmount : "");
            } else state.importRows[index][field] = input.value;
            if (field === "dueDate" && ["standard", "pix"].includes(state.importRows[index].remittanceType)) {
              state.importRows[index].remittanceDate = input.value;
              const remittanceDateInput = card.querySelector('[data-import-field="remittanceDate"]');
              if (remittanceDateInput) remittanceDateInput.value = input.value;
            }
            const needsValue = ["dueDate", "amount", "description", "status", "remittanceType"].includes(field) || (field === "remittanceDate" && !["manual", "gestao"].includes(state.importRows[index].remittanceType));
            input.classList.toggle("ocr-field-missing", needsValue && !input.value);
            if (field === "remittanceType") {
              const hidesDate = input.value === "manual" || input.value === "gestao" || !input.value;
              if (hidesDate) {
                state.importRows[index].remittanceDate = "";
              } else {
                state.importRows[index].remittanceDate = state.importRows[index].dueDate || "";
              }
              card.querySelector(`[data-remittance-date="${index}"]`).classList.toggle("hidden", hidesDate);
              const dateInput = card.querySelector('[data-import-field="remittanceDate"]');
              if (dateInput) {
                dateInput.value = state.importRows[index].remittanceDate;
                dateInput.classList.toggle("ocr-field-missing", !state.importRows[index].remittanceDate);
              }
            }
            renderOcrSummary();
          };
          input.addEventListener("input", update);
          input.addEventListener("change", update);
          if (input.dataset.importField === "amount") {
            input.addEventListener("blur", () => {
              const parsedAmount = parseReviewAmount(input.value);
              if (input.value.trim() === "") { state.importRows[Number(input.closest("[data-import-row]").dataset.importRow)].amount = ""; input.value = ""; }
              else if (parsedAmount !== null && Number.isFinite(parsedAmount)) {
                const index = Number(input.closest("[data-import-row]").dataset.importRow);
                state.importRows[index].amount = parsedAmount;
                input.value = formatReviewAmount(parsedAmount);
              }
            });
          }
        });
      }

      function sortRows(a, b, sort) {
        if (sort === "amount-desc" || sort === "amount-asc") {
          const direction = sort === "amount-desc" ? -1 : 1;
          return ((Number(a.amount) || 0) - (Number(b.amount) || 0)) * direction;
        }
        if (sort === "description-asc") return String(a.description || "").localeCompare(String(b.description || ""), "pt-BR");
        const direction = sort === "date-desc" ? -1 : 1;
        return String(a.dueDate || "").localeCompare(String(b.dueDate || "")) * direction;
      }

      function renderOcrSummary() {
        const summary = $("ocrSummary");
        if (!summary) return;

        const groups = new Map();
        let total = 0;
        state.importRows.forEach((row) => {
          const amount = Number(row.amount);
          if (!Number.isFinite(amount) || amount < 0) return;
          const date = row.dueDate || "";
          if (!groups.has(date)) groups.set(date, 0);
          groups.set(date, groups.get(date) + amount);
          total += amount;
        });

        const company = state.draft && state.draft.companies[state.importCompanyIndex];
        const bankBalance = Number(company && company.balance) || 0;
        let remainingBalance = bankBalance;
        const dateRows = [...groups.entries()]
          .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
          .map(([date, dateTotal]) => {
            remainingBalance -= dateTotal;
            return `
            <div class="ocr-summary-date">
              <div>
                <span>${date ? `Vencimentos de ${escapeHTML(dateBR(date))}` : "Data não informada"}</span>
                <strong>Total da data: ${formatCurrencyBR(dateTotal)}</strong>
              </div>
              <strong class="${remainingBalance < 0 ? "money-negative" : ""}">Saldo após desconto: ${formatCurrencyBR(remainingBalance)}</strong>
            </div>
          `;
          }).join("");

        summary.innerHTML = `
          <div class="ocr-summary-heading">
            <div>
              <strong>Resumo da conferência por data</strong>
              <span>Os valores são atualizados enquanto você corrige os campos.</span>
            </div>
            <span>Saldo do banco: <strong>${formatCurrencyBR(bankBalance)}</strong></span>
          </div>
          <div class="ocr-summary-dates">${dateRows || '<div class="ocr-summary-empty">Informe valores válidos para visualizar o resumo.</div>'}</div>
          <div class="ocr-summary-totals">
            <span>Total final <strong>${formatCurrencyBR(total)}</strong></span>
            <span class="${remainingBalance < 0 ? "money-negative" : ""}">Saldo final após todos os descontos <strong>${formatCurrencyBR(remainingBalance)}</strong></span>
          </div>`;
      }

      function importOcrRows() {
        const company = state.draft.companies[state.importCompanyIndex];
        state.importRows.forEach((row, index) => {
          if (!row.dueDate || row.amount === "" || !Number.isFinite(Number(row.amount)) || Number(row.amount) < 0 || !row.description.trim()) {
            throw new Error(`Confira vencimento, valor e fornecedor/histórico do lançamento ${index + 1}.`);
          }
          if (!["pending", "authorized", "paid", "confirmation"].includes(row.status)) {
            throw new Error(`Confirme a situação do lançamento ${index + 1}.`);
          }
          if (!["standard", "pix", "manual", "gestao"].includes(row.remittanceType)) {
            throw new Error(`Selecione o método bancário do lançamento ${index + 1}.`);
          }
          if (!["manual", "gestao"].includes(row.remittanceType) && !row.remittanceDate) {
            throw new Error(`Informe a data da remessa do lançamento ${index + 1}.`);
          }
        });

        company.payments.push(...state.importRows.map(({ dueDate, amount, description, status, remittanceType, remittanceDate }) => {
          const isManualOrGestao = remittanceType === "manual" || remittanceType === "gestao";
          return {
            dueDate,
            amount: Number(amount),
            description: description.trim(),
            status,
            remittanceType,
            remittanceDate: isManualOrGestao ? "" : (remittanceDate || dueDate)
          };
        }));

        const count = state.importRows.length;
        state.importRows = [];
        $("ocrReview").classList.add("hidden");
        $("printDialog").close();
        if (state.activeCompany === state.importCompanyIndex) renderPayments();
        renderTabs();
        renderOverview();
        updateWhatsAppPreview();
        scheduleAutoSave();
        notify(`${count} lançamento(s) importado(s) com sucesso para ${company.name}!`);
      }

      /* Renderização Principal */
      function render() {
        renderTabs();
        renderPayments();
        renderOverview();
        renderCompanySettings();
        updateWhatsAppPreview();
        $("startDate").value = state.draft.startDate || "";
        $("endDate").value = state.draft.endDate || "";
        $("referenceTime").value = state.draft.referenceTime || "";
        renderHistory().catch(showError);
      }

      function renderTabs() {
        $("companyTabs").innerHTML = state.draft.companies.map((company, index) => {
          const pendingCount = (company.payments || []).filter((p) => p.status === "pending" || p.status === "confirmation").length;
          const badgeClass = pendingCount > 0 ? "tab-badge has-pending" : "tab-badge";
          const badgeText = pendingCount > 0 ? `${pendingCount} a autorizar` : `${(company.payments || []).length}`;
          return `
            <button type="button" class="company-tab${index === state.activeCompany ? " active" : ""}" data-company="${index}">
              <span>${escapeHTML(company.name || DEFAULT_NAMES[index])}</span>
              <span class="${badgeClass}">${badgeText}</span>
            </button>`;
        }).join("");

        $("companyTabs").querySelectorAll("[data-company]").forEach((button) => {
          button.addEventListener("click", () => {
            readActiveCompany();
            state.activeCompany = Number(button.dataset.company);
            renderTabs();
            renderPayments();
            updateCompanyWhatsAppPreview();
            updateWhatsAppPreview();
          });
        });
      }

      function renderPayments() {
        const company = state.draft.companies[state.activeCompany];
        $("balanceInput").value = (company.balance !== undefined && company.balance !== null && company.balance !== "") ? formatCurrencyBR(company.balance) : "";

        let paymentsToRender = company.payments || [];
        if (state.filterText) {
          const term = normalizeText(state.filterText);
          paymentsToRender = paymentsToRender.filter((p) =>
            normalizeText(p.description || "").includes(term) ||
            String(p.amount || "").includes(term) ||
            dateBR(p.dueDate).includes(term)
          );
        }
        if (state.paymentStatusFilter !== "all") {
          paymentsToRender = paymentsToRender.filter((payment) => payment.status === state.paymentStatusFilter);
        }
        const dateDirection = state.paymentSort === "date-desc" ? -1 : 1;
        paymentsToRender.sort((a, b) => {
          const dateOrder = String(a.dueDate || "").localeCompare(String(b.dueDate || "")) * dateDirection;
          return dateOrder || sortRows(a, b, state.paymentSort);
        });

        const dateTotals = new Map();
        paymentsToRender.forEach((payment) => {
          const date = payment.dueDate || "";
          dateTotals.set(date, (dateTotals.get(date) || 0) + (Number(payment.amount) || 0));
        });

        $("paymentRows").innerHTML = paymentsToRender.map((payment, index) => {
          const originalIndex = company.payments.indexOf(payment);
          const remType = paymentRemittanceType(payment);
          const hidesDate = remType === "manual" || remType === "gestao";
          const remClass = hidesDate ? "remittance-cell" : "remittance-cell has-date";
          const isLastOfDate = index === paymentsToRender.length - 1 || paymentsToRender[index + 1].dueDate !== payment.dueDate;
          const dateLabel = payment.dueDate ? dateBR(payment.dueDate) : "Data não informada";
          return `
            <tr data-payment="${originalIndex}">
              <td data-label="Vencimento">
                <input aria-label="Vencimento" type="date" data-field="dueDate" value="${escapeHTML(payment.dueDate || "")}">
              </td>
              <td data-label="Valor (R$)">
                <input aria-label="Valor" type="text" inputmode="decimal" placeholder="R$ 0,00" data-field="amount" value="${escapeHTML(formatPaymentAmount(payment.amount))}">
              </td>
              <td class="description-cell" data-label="Descrição / Fornecedor">
                <input aria-label="Descrição" type="text" maxlength="600" placeholder="Fornecedor, nota fiscal, histórico..." data-field="description" value="${escapeHTML(payment.description || "")}">
              </td>
              <td data-label="Situação">
                <select aria-label="Situação" data-field="status">
                  <option value="pending"${payment.status === "pending" ? " selected" : ""}>✴️ A Autorizar (Pendente)</option>
                  <option value="authorized"${payment.status === "authorized" ? " selected" : ""}>✳️ Autorizado</option>
                  <option value="paid"${payment.status === "paid" ? " selected" : ""}>✅ Pago</option>
                  <option value="confirmation"${payment.status === "confirmation" ? " selected" : ""}>⚠️ Confirmação de Pagamento</option>
                </select>
              </td>
              <td class="${remClass}" data-label="Método / Remessa">
                <select aria-label="Método bancário" data-field="remittanceType">
                  <option value="standard"${remType === "standard" ? " selected" : ""}>✉️ Remessa</option>
                  <option value="pix"${remType === "pix" ? " selected" : ""}>✉️ Remessa_PIX</option>
                  <option value="manual"${remType === "manual" ? " selected" : ""}>📝 Lançamento Manual</option>
                  <option value="gestao"${remType === "gestao" ? " selected" : ""}>📝 Lançamento Gestão</option>
                </select>
                <input aria-label="Data da remessa" type="date" data-field="remittanceDate" value="${escapeHTML(paymentRemittanceDate(payment))}"${hidesDate ? ' class="hidden"' : ""}>
              </td>
              <td style="text-align: center;">
                <div class="row-actions">
                  <button type="button" class="action-btn-sm" data-duplicate="${originalIndex}" title="Duplicar este lançamento">📋</button>
                  <button type="button" class="action-btn-sm delete" data-remove="${originalIndex}" title="Remover lançamento">✕</button>
                </div>
              </td>
            </tr>
            ${isLastOfDate ? `
            <tr class="payment-date-total">
              <td colspan="6">
                <div class="payment-date-total-content">
                  <span>Total de ${escapeHTML(dateLabel)}</span>
                  <strong>${formatCurrencyBR(dateTotals.get(payment.dueDate || "") || 0)}</strong>
                </div>
              </td>
            </tr>` : ""}`;
        }).join("");

        $("emptyPayments").classList.toggle("hidden", paymentsToRender.length > 0);

        $("paymentRows").querySelectorAll("[data-field]").forEach((input) => {
          input.addEventListener("input", updatePaymentFromInput);
          input.addEventListener("change", (event) => {
            updatePaymentFromInput(event);
            if (event.target.dataset.field === "dueDate") {
              renderPayments();
              return;
            }
            if (event.target.dataset.field === "remittanceType") {
              const cell = event.target.closest(".remittance-cell");
              const dateInput = cell.querySelector('[data-field="remittanceDate"]');
              const hides = event.target.value === "manual" || event.target.value === "gestao";
              cell.classList.toggle("has-date", !hides);
              dateInput.classList.toggle("hidden", hides);
            }
          });
          if (input.dataset.field === "amount") {
            input.addEventListener("input", updatePaymentDateTotals);
            input.addEventListener("blur", () => {
              const payment = company.payments[Number(input.closest("[data-payment]").dataset.payment)];
              input.value = formatPaymentAmount(payment.amount);
              updatePaymentDateTotals();
            });
          }
        });

        $("paymentRows").querySelectorAll("[data-remove]").forEach((btn) => {
          btn.addEventListener("click", () => {
            readActiveCompany();
            company.payments.splice(Number(btn.dataset.remove), 1);
            renderPayments();
            renderTabs();
            renderOverview();
            updateWhatsAppPreview();
            scheduleAutoSave();
          });
        });

        $("paymentRows").querySelectorAll("[data-duplicate]").forEach((btn) => {
          btn.addEventListener("click", () => {
            readActiveCompany();
            const source = company.payments[Number(btn.dataset.duplicate)];
            company.payments.push({ ...source });
            renderPayments();
            renderTabs();
            renderOverview();
            updateWhatsAppPreview();
            scheduleAutoSave();
            notify("Lançamento duplicado.");
          });
        });

        $("companyTotals").innerHTML = totalsMarkup(company);
      }

      function updatePaymentDateTotals() {
        const company = state.draft.companies[state.activeCompany];
        if (!company) return;
        $("paymentRows").querySelectorAll(".payment-date-total").forEach((totalRow) => {
          let row = totalRow.previousElementSibling;
          let total = 0;
          while (row && row.matches("tr[data-payment]")) {
            total += Number(company.payments[Number(row.dataset.payment)]?.amount) || 0;
            row = row.previousElementSibling;
          }
          const value = totalRow.querySelector(".payment-date-total-content strong");
          if (value) value.textContent = formatCurrencyBR(total);
        });
      }

      function totalsMarkup(company) {
        const totals = paymentTotals(company);
        const balance = Number(company.balance) || 0;
        const forecast = balance - totals.forecastOutflow;
        return `
          <span>Saldo Inicial: <strong>${formatCurrencyBR(balance)}</strong></span>
          <span>A Pagar: <strong>${formatCurrencyBR(totals.payable)}</strong></span>
          <span>Autorizado/Pago: <strong>${formatCurrencyBR(totals.authorizedOrPaid)}</strong></span>
          <span class="pending">A Autorizar: <strong>${formatCurrencyBR(totals.pending)}</strong></span>
          <span class="forecast">Previsão Final: <strong class="${forecast < 0 ? "money-negative" : ""}">${formatCurrencyBR(forecast)}</strong></span>`;
      }

      function updatePaymentFromInput(event) {
        const row = event.target.closest("[data-payment]");
        const company = state.draft.companies[state.activeCompany];
        const payment = company.payments[Number(row.dataset.payment)];
        const field = event.target.dataset.field;

        if (field === "amount") {
          payment[field] = parsePaymentAmount(event.target.value);
        } else if (field === "remittanceType") {
          payment.remittanceType = event.target.value;
          if (event.target.value === "manual" || event.target.value === "gestao") {
            payment.remittanceDate = "";
          } else if (!payment.remittanceDate) {
            payment.remittanceDate = payment.dueDate || state.draft.endDate;
          }
        } else if (field === "remittanceDate") {
          payment.remittanceDate = event.target.value;
        } else {
          payment[field] = event.target.value;
          if (field === "dueDate" && ["standard", "pix"].includes(paymentRemittanceType(payment))) {
            payment.remittanceDate = event.target.value;
            const remittanceDateInput = row.querySelector('[data-field="remittanceDate"]');
            if (remittanceDateInput) remittanceDateInput.value = event.target.value;
          }
        }

        $("companyTotals").innerHTML = totalsMarkup(company);
        renderOverview();
        renderTabs();
        updateWhatsAppPreview();
        scheduleAutoSave();
      }

      function readActiveCompany() {
        const company = state.draft.companies[state.activeCompany];
        if (company) {
          const val = $("balanceInput").value;
          company.balance = val === "" ? 0 : (parsePaymentAmount(val) || 0);
        }
      }

      function readMetadata() {
        if (!state.draft) return;
        state.draft.startDate = $("startDate").value;
        state.draft.endDate = $("endDate").value;
        state.draft.referenceTime = $("referenceTime").value;
        readActiveCompany();
      }

      function renderOverview() {
        const companies = state.draft.companies;
        const balance = companies.reduce((sum, company) => sum + (Number(company.balance) || 0), 0);
        const pending = companies.reduce((sum, company) => sum + paymentTotals(company).pending, 0);
        const forecast = companies.reduce((sum, company) => sum + (Number(company.balance) || 0) - paymentTotals(company).forecastOutflow, 0);

        $("overallBalance").textContent = formatCurrencyBR(balance);
        $("overallPending").textContent = formatCurrencyBR(pending);
        $("overallForecast").textContent = formatCurrencyBR(forecast);
        $("overallForecast").classList.toggle("money-negative", forecast < 0);
      }

      /* Histórico de Levantamentos */
      async function renderHistory() {
        if (!state.historyUnlocked) {
          $("historyList").innerHTML = `
            <div class="history-locked">
              <strong>🔒 Histórico protegido</strong>
              <span>Os levantamentos salvos não são exibidos nesta sessão.</span>
              <button class="button small primary" type="button" id="unlockHistoryButton">🔓 Desbloquear com senha</button>
            </div>`;
          $("unlockHistoryButton").addEventListener("click", () => unlockHistory().catch(showError));
          return;
        }
        let reports = [];
        let serverErrorOccurred = false;

        // Se estiver conectado ou no modo de tentar servidor, busca os relatórios do MySQL
        if (state.serverConnected || state.storageMode === "server" || state.storageMode === "auto") {
          try {
            const serverReports = await apiRequest("/reports");
            if (Array.isArray(serverReports)) {
              reports.push(...serverReports.map((r) => ({ ...r, _storage: "server" })));
            }
          } catch (err) {
            serverErrorOccurred = true;
            console.warn("Falha ao buscar histórico do servidor MySQL:", err);
          }
        }

        // Busca também os relatórios locais do IndexedDB (armazenamento offline)
        try {
          const localReports = await storeRequest("reports", "readonly", (store) => store.getAll());
          if (Array.isArray(localReports)) {
            // Evitar duplicar visualmente caso tenham o mesmo ID e storage
            reports.push(...localReports.map((r) => ({ ...r, _storage: "local" })));
          }
        } catch (err) {
          console.warn("Falha ao buscar histórico local IndexedDB:", err);
        }

        reports.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));

        $("historyList").innerHTML = reports.length ? reports.map((report) => {
          const label = `${dateBR(report.startDate)} a ${dateBR(report.endDate)}`;
          const dateSaved = new Date(report.savedAt).toLocaleString("pt-BR");
          const totalPayments = report.companies.reduce((sum, c) => sum + (c.payments ? c.payments.length : 0), 0);
          const isServer = report._storage === "server";
          const badgeHtml = isServer
            ? `<span class="tab-badge" style="background: var(--green-badge); color: var(--green-badge-text); margin-left: 8px;">☁️ Servidor MySQL</span>`
            : `<span class="tab-badge" style="background: var(--amber-badge); color: var(--amber-badge-text); margin-left: 8px;">💾 Navegador (Local)</span>`;

          return `
            <div class="history-item">
              <div>
                <div class="history-title">📅 Levantamento: ${escapeHTML(label)} ${badgeHtml}</div>
                <div class="history-meta">Salvo em ${escapeHTML(dateSaved)} · ${report.companies.length} empresas · ${totalPayments} lançamento(s)</div>
              </div>
              <div class="history-actions">
                <button class="button small" type="button" data-load="${report.id}" data-storage="${report._storage || "local"}">Abrir</button>
                <button class="button small danger" type="button" data-delete="${report.id}" data-storage="${report._storage || "local"}">Excluir</button>
              </div>
            </div>`;
        }).join("") : `<div class="empty-history">${serverErrorOccurred ? "Servidor MySQL indisponível no momento. " : ""}Nenhum levantamento salvo ainda. Crie o primeiro acima e clique em 'Salvar Levantamento'.</div>`;

        $("historyList").querySelectorAll("[data-load]").forEach((button) => {
          button.addEventListener("click", () => loadReport(Number(button.dataset.load), button.dataset.storage));
        });
        $("historyList").querySelectorAll("[data-delete]").forEach((button) => {
          button.addEventListener("click", () => deleteReport(Number(button.dataset.delete), button.dataset.storage));
        });
      }

      function validateDraft() {
        if (!state.draft.startDate || !state.draft.endDate) throw new Error("Informe as datas inicial e final do levantamento.");
        if (state.draft.endDate < state.draft.startDate) throw new Error("A data final não pode ser anterior à data inicial.");
        for (const company of state.draft.companies) {
          for (const payment of company.payments) {
            if (payment.amount === "" || !Number.isFinite(Number(payment.amount)) || Number(payment.amount) < 0) {
              throw new Error(`Confira os valores dos lançamentos de ${company.name}.`);
            }
            const remType = paymentRemittanceType(payment);
            if ((remType === "standard" || remType === "pix") && !paymentRemittanceDate(payment)) {
              throw new Error(`Informe a data da remessa de ${company.name}.`);
            }
            if (!payment.dueDate) throw new Error(`Informe o vencimento de todos os lançamentos de ${company.name}.`);
            if (!payment.description.trim()) throw new Error(`Informe a descrição de todos os lançamentos de ${company.name}.`);
          }
        }
      }

      async function saveReport() {
        readMetadata(); validateDraft();
        const record = JSON.parse(JSON.stringify(state.draft));
        record.savedAt = new Date().toISOString(); delete record._storage;
        if (state.serverConnected) {
          try {
            const saved = state.draft._storage === "server" && state.draft.id
              ? await apiRequest(`/reports/${state.draft.id}`, "PUT", record)
              : await apiRequest("/reports", "POST", (() => { const copy = { ...record }; delete copy.id; return copy; })());
            state.draft.id = Number(saved.id); state.draft._storage = "server";
          } catch (error) {
            state.serverConnected = false; setStorageStatus("local", "Servidor indisponível · usando este navegador");
            notify(`Servidor indisponível; salvando localmente. ${error.message}`, true);
            if (state.draft._storage === "server") delete record.id;
            state.draft.id = Number(await storeRequest("reports", "readwrite", (store) => record.id ? store.put(record) : store.add(record)));
            state.draft._storage = "local";
          }
        } else {
          if (state.draft._storage === "server") delete record.id;
          state.draft.id = Number(await storeRequest("reports", "readwrite", (store) => record.id ? store.put(record) : store.add(record)));
          state.draft._storage = "local";
        }
        $("saveReportButton").textContent = "💾 Atualizar Levantamento";
        notify(state.draft._storage === "server" ? "Levantamento salvo no servidor MySQL." : "Levantamento salvo neste navegador.");
        await renderHistory();
      }

      async function loadReport(id, storage = "local") {
        requireHistoryAccess();
        const report = storage === "server" ? await apiRequest(`/reports/${id}`) : await storeRequest("reports", "readonly", (store) => store.get(id));
        if (!report) throw new Error("Levantamento não encontrado.");
        report._storage = storage;
        report.companies.forEach((company, index) => { if (!company.name || company.name === `Empresa ${index + 1}`) company.name = state.companies[index] || DEFAULT_NAMES[index]; });
        state.draft = report; state.activeCompany = 0;
        $("saveReportButton").textContent = "💾 Atualizar Levantamento";
        render(); scheduleAutoSave(); notify("Levantamento carregado para consulta ou edição.");
      }

      async function deleteReport(id, storage = "local") {
        requireHistoryAccess();
        if (!window.confirm("Deseja realmente excluir este levantamento salvo? Esta ação não pode ser desfeita.")) return;
        if (storage === "server") await apiRequest(`/reports/${id}`, "DELETE");
        else await storeRequest("reports", "readwrite", (store) => store.delete(id));
        if (state.draft.id === id && state.draft._storage === storage) { state.draft.id = null; state.draft._storage = null; $("saveReportButton").textContent = "💾 Salvar Levantamento"; }
        await renderHistory(); notify("Levantamento excluído com sucesso.");
      }

      /* Utilitários de Dias Úteis */
      function parseISODate(isoStr) {
        const [y, m, d] = isoStr.split("-").map(Number);
        return new Date(y, m - 1, d);
      }

      function formatISODate(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      }

      function getBusinessDaysInRange(minDateStr, maxDateStr) {
        if (!minDateStr || !maxDateStr) return [];
        const current = parseISODate(minDateStr);
        const end = parseISODate(maxDateStr);
        const list = [];
        while (current <= end) {
          const dayOfWeek = current.getDay(); // 0 = Domingo, 6 = Sábado
          if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            list.push(formatISODate(current));
          }
          current.setDate(current.getDate() + 1);
        }
        return list;
      }

      /* Formatação WhatsApp 100% Fiel ao Modelo Padrão */
      const WHATSAPP_SEPARATOR = "────────────────────";

      function getRelevantPaymentDates(company) {
        const paymentDates = (company.payments || []).map((p) => p.dueDate).filter(Boolean);
        if (!state.draft.startDate || !state.draft.endDate) return [...new Set(paymentDates)].sort();

        const minDate = [state.draft.startDate, ...paymentDates].sort()[0];
        const maxDate = [state.draft.endDate, ...paymentDates].sort().reverse()[0];
        const dates = [];
        const current = parseISODate(minDate);
        const end = parseISODate(maxDate);
        while (current <= end) {
          dates.push(formatISODate(current));
          current.setDate(current.getDate() + 1);
        }
        paymentDates.forEach((date) => {
          if (!dates.includes(date)) dates.push(date);
        });
        return dates.sort();
      }

      function formatCompanyWhatsApp(company, index, includeHeading = true) {
        const lines = [];
        const totals = paymentTotals(company);
        const companyName = company.name.trim() || `Empresa ${index + 1}`;
        const balanceLabel = "Saldo Bradesco";
        const balanceFormatted = formatCurrencyBR(Number(company.balance) || 0);
        const totalPayable = formatCurrencyBR(totals.payable);
        const finalBalance = (Number(company.balance) || 0) - totals.payable;

        lines.push(`${index + 1}️⃣ *${companyName}*`);
        lines.push(`💵 ${balanceLabel}: *${balanceFormatted}*`);
        lines.push(`✴️ Soma total a Pagar: *${totalPayable}*`);
        lines.push(`✅ Saldo Final Bradesco: *${formatCurrencyBR(finalBalance)}*`);
        lines.push(WHATSAPP_SEPARATOR);
        lines.push("");

        const allDates = getRelevantPaymentDates(company);
        if (allDates.length === 0) {
          lines.push(`➡️ *PARA ${dateBR(state.draft.startDate)}:* 🆗 Sem movimentação.`);
          lines.push(WHATSAPP_SEPARATOR);
        } else {
          allDates.forEach((date, dateIndex) => {
            const paymentsForDate = (company.payments || []).filter((p) => p.dueDate === date);
            if (dateIndex > 0) lines.push("");
            if (paymentsForDate.length === 0) {
              lines.push(`➡️ *PARA ${dateBR(date)}:* 🆗 Sem movimentação.`);
              lines.push(WHATSAPP_SEPARATOR);
              return;
            }

            const dayPayable = paymentsForDate.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
            const dayAuthorizedOrPaid = paymentsForDate
              .filter((p) => p.status === "paid" || p.status === "authorized")
              .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
            const dayPending = paymentsForDate
              .filter((p) => p.status === "pending" || p.status === "confirmation")
              .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
            const hasConfirmation = paymentsForDate.some((p) => p.status === "confirmation");
            const paymentsToDescribe = paymentsForDate.filter((p) => p.status !== "authorized" && p.status !== "paid");

            lines.push(`➡️ *PARA ${dateBR(date)}:*${hasConfirmation ? " _(CONFIRMAÇÃO DE PAGAMENTO)_" : ""}`);
            lines.push(`💵 *Total a pagar:* *${formatCurrencyBR(dayPayable)}*`);
            lines.push(`✳️ *Autorizado/Pago:* *${formatCurrencyBR(dayAuthorizedOrPaid)}*`);
            if (dayPending > 0) lines.push(`✴️ *A autorizar:* *${formatCurrencyBR(dayPending)}*`);

            const groups = {};
            paymentsToDescribe.forEach((payment) => {
              const type = paymentRemittanceType(payment);
              const remittanceDate = (type === "standard" || type === "pix") ? paymentRemittanceDate(payment) : "";
              const key = `${type}_${remittanceDate}`;
              if (!groups[key]) groups[key] = { type, remittanceDate, items: [] };
              groups[key].items.push(payment);
            });

            const remittancePriority = { standard: 0, pix: 1, manual: 2, gestao: 3 };
            Object.values(groups)
              .sort((a, b) => (remittancePriority[a.type] ?? 99) - (remittancePriority[b.type] ?? 99))
              .forEach((group) => {
              const groupTotal = group.items.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
              const typeLabel = group.type === "standard" ? "Remessa"
                : group.type === "pix" ? "Remessa PIX"
                  : group.type === "gestao" ? "Lançamento Gestão" : "Lançamento Manual";
              const dateLabel = group.remittanceDate ? ` ${dateShort(group.remittanceDate)}` : "";
              lines.push("");
              lines.push(`✉️ *${typeLabel}${dateLabel}* — *${formatCurrencyBR(groupTotal)}*`);
              group.items.forEach((payment) => {
                lines.push(`✔️ ${formatCurrencyBR(Number(payment.amount) || 0)} | ${payment.description.trim() || "Sem descrição"}`);
                });
            });
            lines.push(WHATSAPP_SEPARATOR);
          });
        }

        if (allDates.length) lines.push("");
        return includeHeading ? lines : lines.slice(2);
      }

      function formatWhatsApp() {
        if (!state.draft) return "";
        readMetadata();
        const start = dateBR(state.draft.startDate);
        const end = dateBR(state.draft.endDate);
        const time = state.draft.referenceTime ? ` até as ${state.draft.referenceTime}h` : "";
        const lines = [`📊 *LEVANTAMENTO FINANCEIRO*`, `📅 Período: *${start} a ${end}${time}*`, ""];

        state.draft.companies.forEach((company, index) => {
          lines.push(...formatCompanyWhatsApp(company, index));
          lines.push("");
          lines.push(WHATSAPP_SEPARATOR);
          lines.push("");
        });

        return lines.join("\n").trim();
      }

      function formatWhatsAppLegacy() {
        if (!state.draft) return "";
        readMetadata();
        const start = dateBR(state.draft.startDate);
        const end = dateBR(state.draft.endDate);
        const time = state.draft.referenceTime ? ` até as ${state.draft.referenceTime}h` : "";
        const lines = [`*Segue Levantamento para ${start} a ${end}${time}*`, ""];

        state.draft.companies.forEach((company, index) => {
          const totals = paymentTotals(company);
          const companyName = company.name.trim() || `Empresa ${index + 1}`;
          const isSecondCompany = index === 1; // "Saldo inicial:" em BOA VISTA ou "Saldo:" nas demais
          const balanceLabel = isSecondCompany ? "Saldo inicial" : "Saldo";
          const balanceFormatted = formatCurrencyBR(Number(company.balance) || 0);

          lines.push(`${index + 1}️⃣ *${companyName}*`);
          lines.push(`💵 ${balanceLabel}: *${balanceFormatted}*`);
          lines.push("------------------------------------------------");

          // Determinar as datas relevantes a serem listadas
          const paymentDates = (company.payments || []).map((p) => p.dueDate).filter(Boolean);
          let allDates = [];

          if (state.draft.startDate && state.draft.endDate) {
            const minDate = [state.draft.startDate, ...paymentDates].sort()[0];
            const maxDate = [state.draft.endDate, ...paymentDates].sort().reverse()[0];
            allDates = getBusinessDaysInRange(minDate, maxDate);
            // Incluir qualquer outra data que tenha pagamentos lançados
            paymentDates.forEach((d) => {
              if (!allDates.includes(d)) allDates.push(d);
            });
            allDates.sort();
          } else {
            allDates = [...new Set(paymentDates)].sort();
          }

          if (allDates.length === 0) {
            lines.push(`➡️ *PARA ${start}:* 🆗`);
            lines.push("------------------------------------------------");
          } else {
            allDates.forEach((date) => {
              const paymentsForDate = (company.payments || []).filter((p) => p.dueDate === date);

              if (paymentsForDate.length === 0) {
                lines.push(`➡️ *PARA ${dateBR(date)}:* 🆗`);
                lines.push("------------------------------------------------");
              } else {
                const dayPayable = paymentsForDate.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
                const dayAuthorizedOrPaid = paymentsForDate
                  .filter((p) => p.status === "paid" || p.status === "authorized")
                  .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
                const dayPending = paymentsForDate
                  .filter((p) => p.status === "pending" || p.status === "confirmation")
                  .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
                const hasConfirmation = paymentsForDate.some((p) => p.status === "confirmation");

                const dateTag = hasConfirmation ? " (CONFIRMAÇÃO DE PAGAMENTO)" : "";
                lines.push(`➡️ *PARA ${dateBR(date)}:*${dateTag}`);
                lines.push(`💵 *Total A Pagar:* ${formatCurrencyBR(dayPayable)}`);
                lines.push(`✳️ *Total Autorizado/Pago:* ${formatCurrencyBR(dayAuthorizedOrPaid)}`);
                lines.push(`✴️ *Total a Autorizar:* ${formatCurrencyBR(dayPending)}`);

                // Agrupamento inteligente por Método / Remessa
                const groups = {};
                paymentsForDate.forEach((p) => {
                  const type = paymentRemittanceType(p);
                  const rDate = (type === "standard" || type === "pix") ? paymentRemittanceDate(p) : "";
                  const key = `${type}_${rDate}`;
                  if (!groups[key]) {
                    groups[key] = { type, rDate, items: [] };
                  }
                  groups[key].items.push(p);
                });

                Object.values(groups).forEach((group) => {
                  lines.push("");
                  const groupTotal = group.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
                  const totalStr = formatCurrencyBR(groupTotal);

                  if (group.type === "standard") {
                    const dStr = group.rDate ? ` ${dateShort(group.rDate)}` : "";
                    lines.push(`✉️ *Remessa${dStr} - ${totalStr}:*`);
                  } else if (group.type === "pix") {
                    const dStr = group.rDate ? ` ${dateShort(group.rDate)}` : "";
                    lines.push(`✉️ *Remessa_PIX${dStr} - ${totalStr}:*`);
                  } else if (group.type === "gestao") {
                    lines.push(`📝 *Lançamento Gestão - ${totalStr}*`);
                  } else {
                    lines.push(`📝 *Lançamento Manual | ${totalStr}*`);
                  }

                  group.items.forEach((it) => {
                    const itemAmount = formatCurrencyBR(Number(it.amount) || 0);
                    lines.push(`✔️ ${itemAmount} | ${it.description.trim()}`);
                  });
                });

                lines.push("------------------------------------------------");
              }
            });
          }

          const forecast = (Number(company.balance) || 0) - totals.forecastOutflow;
          lines.push("____________________________________________");
          lines.push(`💵 Previsão de Saldo Final: *${formatCurrencyBR(forecast)}*`);
          lines.push("____________________________________________");
          lines.push("");
        });

        return lines.join("\n");
      }

      function updateWhatsAppPreview() {
        const text = formatWhatsApp();
        const preview = $("whatsappPreview");
        if (preview) preview.textContent = text || "Preencha os dados do levantamento para visualizar a mensagem.";
        updateCompanyWhatsAppPreview();
      }

      async function copyWhatsApp() {
        const text = formatWhatsApp();
        if (!navigator.clipboard || !navigator.clipboard.writeText) {
          throw new Error("A cópia automática não está disponível neste navegador. Use a opção 'Baixar .txt'.");
        }
        await navigator.clipboard.writeText(text);
        notify("Mensagem copiada para a área de transferência! Cole no WhatsApp.");
      }

      async function copyCompanyWhatsApp() {
        const company = state.draft && state.draft.companies[state.activeCompany];
        if (!company) return;
        const text = formatCompanyWhatsApp(company, state.activeCompany).join("\n");
        if (!navigator.clipboard || !navigator.clipboard.writeText) {
          throw new Error("A cópia automática não está disponível neste navegador.");
        }
        await navigator.clipboard.writeText(text);
        notify(`Mensagem da empresa ${company.name} copiada para a área de transferência!`);
      }

      function updateCompanyWhatsAppPreview() {
        const company = state.draft && state.draft.companies[state.activeCompany];
        if (!company) return;
        $("companyPreviewName").textContent = company.name || `Empresa ${state.activeCompany + 1}`;
        $("companyWhatsAppPreview").textContent = formatCompanyWhatsApp(company, state.activeCompany).join("\n");
      }

      function openWhatsApp() {
        const text = formatWhatsApp();
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
      }

      function downloadWhatsApp() {
        const text = formatWhatsApp();
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `levantamento-${state.draft.startDate}-${state.draft.endDate}.txt`;
        link.click();
        URL.revokeObjectURL(url);
      }

      /* Exportação para CSV (Excel Brasil com UTF-8 BOM e separador ;) */
      function exportToCSV() {
        readMetadata();
        const rows = [
          ["Empresa", "Vencimento", "Valor (R$)", "Situação", "Descrição", "Método", "Data Remessa"]
        ];

        state.draft.companies.forEach((company) => {
          (company.payments || []).forEach((p) => {
            let statusText = "A Autorizar";
            if (p.status === "paid") statusText = "Pago";
            else if (p.status === "authorized") statusText = "Autorizado";
            else if (p.status === "confirmation") statusText = "Confirmação de Pagamento";

            const valFormatted = Number(p.amount || 0).toFixed(2).replace(".", ",");
            rows.push([
              company.name,
              dateBR(p.dueDate),
              valFormatted,
              statusText,
              p.description || "",
              remittanceLabel(p),
              dateBR(paymentRemittanceDate(p))
            ]);
          });
        });

        const csvContent = "\uFEFF" + rows.map((row) =>
          row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")
        ).join("\r\n");

        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `levantamento-financeiro-${state.draft.startDate}-a-${state.draft.endDate}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        notify("Planilha CSV exportada com sucesso para o Excel!");
      }

      /* Adicionar e Manipular Lançamentos */
      function addPayment() {
        readActiveCompany();
        const company = state.draft.companies[state.activeCompany];
        company.payments.push({
          dueDate: state.draft.endDate || todayISO(),
          amount: "",
          description: "",
          status: "pending",
          remittanceType: "standard",
          remittanceDate: state.draft.endDate || todayISO()
        });
        renderPayments();
        renderTabs();
        renderOverview();
        updateWhatsAppPreview();
        scheduleAutoSave();

        const rows = $("paymentRows").querySelectorAll("tr");
        if (rows.length) {
          const lastRow = rows[rows.length - 1];
          const amountInput = lastRow.querySelector('[data-field="amount"]');
          if (amountInput) amountInput.focus();
        }
      }

      function markAllCompanyPayments(newStatus) {
        readActiveCompany();
        const company = state.draft.companies[state.activeCompany];
        if (!company.payments.length) return;
        company.payments.forEach((p) => { p.status = newStatus; });
        renderPayments();
        renderTabs();
        renderOverview();
        updateWhatsAppPreview();
        scheduleAutoSave();
        notify(`Todos os lançamentos de ${company.name} foram marcados como ${newStatus === "paid" ? "Pagos" : "Autorizados"}!`);
      }

      function clearCompanyPayments() {
        const company = state.draft.companies[state.activeCompany];
        if (!company.payments.length) return;
        if (!window.confirm(`Tem certeza que deseja apagar todos os lançamentos da empresa ${company.name}?`)) return;
        readActiveCompany();
        company.payments = [];
        renderPayments();
        renderTabs();
        renderOverview();
        updateWhatsAppPreview();
        scheduleAutoSave();
        notify(`Lançamentos de ${company.name} foram removidos.`);
      }

      function startNewReport() {
        if (window.confirm("Iniciar um novo levantamento? Os dados atuais não salvos serão descartados.")) {
          localStorage.removeItem(AUTOSAVE_KEY);
          state.draft = newDraft();
          state.activeCompany = 0;
          $("saveReportButton").textContent = "💾 Salvar Levantamento";
          render();
          notify("Novo levantamento iniciado.");
        }
      }

      /* Configuração dos Nomes das Empresas */
      function renderCompanySettings() {
        const grid = $("settingsGrid");
        grid.innerHTML = state.companies.map((name, index) => `
          <div class="field">
            <label for="companyNameInput_${index}">Empresa ${index + 1}</label>
            <input type="text" id="companyNameInput_${index}" data-company-name-index="${index}" value="${escapeHTML(name)}">
          </div>
        `).join("");
      }

      async function saveCompanyNames() {
        const inputs = $("settingsGrid").querySelectorAll("[data-company-name-index]");
        const newNames = [];
        inputs.forEach((input, index) => {
          const val = input.value.trim() || DEFAULT_NAMES[index];
          newNames.push(val);
        });
        state.companies = newNames;
        if (state.draft && state.draft.companies) {
          state.draft.companies.forEach((comp, idx) => {
            comp.name = state.companies[idx];
          });
        }
        await storeRequest("settings", "readwrite", (store) => store.put({ key: "companyNames", value: state.companies }));
        if (state.serverConnected) {
          try {
            await apiRequest("/settings/company-names", "PUT", state.companies);
          } catch (err) {
            console.warn("Não foi possível sincronizar os nomes no MySQL:", err);
          }
        }
        renderTabs();
        updateWhatsAppPreview();
        scheduleAutoSave();
        notify("Nomes das empresas atualizados com sucesso!");
      }

      async function resetCompanyNames() {
        if (!window.confirm("Restaurar os nomes das empresas para o padrão?")) return;
        state.companies = [...DEFAULT_NAMES];
        if (state.draft && state.draft.companies) {
          state.draft.companies.forEach((comp, idx) => {
            comp.name = state.companies[idx];
          });
        }
        await storeRequest("settings", "readwrite", (store) => store.put({ key: "companyNames", value: state.companies }));
        if (state.serverConnected) {
          try {
            await apiRequest("/settings/company-names", "PUT", state.companies);
          } catch (err) {
            console.warn("Não foi possível sincronizar os nomes no MySQL:", err);
          }
        }
        renderCompanySettings();
        renderTabs();
        updateWhatsAppPreview();
        scheduleAutoSave();
        notify("Nomes restaurados para o padrão.");
      }

      /* Backup e Restauração */
      async function exportBackup() {
        requireHistoryAccess();
        const reports = await storeRequest("reports", "readonly", (store) => store.getAll());
        const settings = await storeRequest("settings", "readonly", (store) => store.getAll());
        const backupData = {
          app: "LevFin",
          version: "2.1",
          exportedAt: new Date().toISOString(),
          companies: state.companies,
          reports,
          settings
        };
        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `backup-levfin-${todayISO()}.json`;
        link.click();
        URL.revokeObjectURL(url);
        notify("Backup baixado com sucesso!");
      }

      async function importBackup(file) {
        if (!file) return;
        try {
          requireHistoryAccess();
          const text = await file.text();
          const data = JSON.parse(text);
          if (!data || !Array.isArray(data.reports)) {
            throw new Error("Arquivo de backup inválido.");
          }
          if (!window.confirm(`Este backup contém ${data.reports.length} levantamento(s). Deseja restaurá-los no seu banco de dados local?`)) {
            return;
          }

          for (const report of data.reports) {
            await storeRequest("reports", "readwrite", (store) => store.put(report));
          }
          if (Array.isArray(data.companies) && data.companies.length === COMPANY_COUNT) {
            state.companies = data.companies;
            await storeRequest("settings", "readwrite", (store) => store.put({ key: "companyNames", value: state.companies }));
          }
          await renderHistory();
          renderCompanySettings();
          renderTabs();
          notify("Backup restaurado com sucesso!");
        } catch (err) {
          showError(err);
        } finally {
          $("backupImportInput").value = "";
        }
      }

      /* Alternar Modo Escuro */
      function initTheme() {
        const saved = localStorage.getItem(THEME_KEY);
        if (saved === "dark") {
          document.documentElement.setAttribute("data-theme", "dark");
        } else if (!saved && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
          document.documentElement.setAttribute("data-theme", "dark");
        }
      }

      function toggleTheme() {
        const isDark = document.documentElement.getAttribute("data-theme") === "dark";
        const newTheme = isDark ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", newTheme);
        localStorage.setItem(THEME_KEY, newTheme);
      }

      /* Configuração de Drag & Drop e Cola Global (Ctrl+V) */
      function setupClipboardAndDropZone() {
        const pasteBox = $("printPasteBox");
        pasteBox.addEventListener("paste", (event) => {
          const items = (event.clipboardData || window.clipboardData)?.items;
          if (!items) return;
          for (const item of items) {
            if (item.type.indexOf("image") !== -1) {
              const file = item.getAsFile();
              if (file) {
                event.preventDefault();
                notify("Imagem capturada da área de transferência! Processando OCR...");
                processScreenshot(file).catch(showError);
              }
            }
          }
        });

        const dropZone = $("importDropZone");
        ["dragenter", "dragover"].forEach((eventName) => {
          dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.add("dragover");
          });
        });
        ["dragleave", "drop"].forEach((eventName) => {
          dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.remove("dragover");
          });
        });
        dropZone.addEventListener("drop", (e) => {
          const files = e.dataTransfer?.files;
          if (files && files.length > 0) {
            processScreenshot(files[0]).catch(showError);
          }
        });
        pasteBox.addEventListener("click", (event) => {
          if (event.target === pasteBox || event.target.tagName !== "BUTTON") pasteBox.focus();
        });
      }

      /* Inicialização Geral da Aplicação */
      async function initialize() {
        initTheme();
        loadStorageConfig();
        try {
          state.db = await openDatabase();

          // Inicializar conexão com o servidor MySQL (se não estiver em modo exclusivamente local)
          await checkServerConnection(false);

          let savedNames = [];
          if (state.serverConnected) {
            try {
              const remoteNames = await apiRequest("/settings/company-names");
              if (Array.isArray(remoteNames) && remoteNames.length === COMPANY_COUNT) {
                savedNames = remoteNames;
              }
            } catch (_) {}
          }

          if (!savedNames.length) {
            const savedSettings = await storeRequest("settings", "readonly", (store) => store.get("companyNames"));
            if (savedSettings && Array.isArray(savedSettings.value) && savedSettings.value.length === COMPANY_COUNT) {
              savedNames = savedSettings.value;
            }
          }

          state.companies = DEFAULT_NAMES.map((defaultName, index) => {
            const savedName = typeof savedNames[index] === "string" ? savedNames[index].trim() : "";
            return !savedName || savedName === `Empresa ${index + 1}` ? defaultName : savedName;
          });

          if (JSON.stringify(savedNames) !== JSON.stringify(state.companies)) {
            await storeRequest("settings", "readwrite", (store) => store.put({ key: "companyNames", value: state.companies }));
          }

          const autoSaved = loadAutoSavedDraft();
          if (autoSaved) {
            state.draft = autoSaved;
            state.draft.companies.forEach((comp, idx) => {
              if (state.companies[idx]) comp.name = state.companies[idx];
            });
            $("autoSaveIndicator").textContent = "⚡ Rascunho restaurado";
          } else {
            state.draft = newDraft();
          }

          render();
          setupClipboardAndDropZone();
        } catch (error) {
          setStorageStatus("error", "Erro ao carregar");
          showError(error);
          $("historyList").innerHTML = '<div class="empty-history">O armazenamento não pôde ser iniciado.</div>';
        }
      }

      /* Event Listeners */
      $("storageSettingsButton").addEventListener("click", () => {
        $("storageSettings").classList.toggle("hidden");
      });

      const serverPowerSwitch = $("serverPowerSwitch");
      if (serverPowerSwitch) {
        serverPowerSwitch.addEventListener("change", async (e) => {
          if (e.target.checked) {
            state.storageMode = "auto";
            if ($("storageMode")) $("storageMode").value = "auto";
          } else {
            state.storageMode = "local";
            if ($("storageMode")) $("storageMode").value = "local";
          }
          saveStorageConfig();
          await checkServerConnection(true);
          await renderHistory();
        });
      }

      $("storageMode").addEventListener("change", async () => {
        saveStorageConfig();
        await checkServerConnection(true);
        await renderHistory();
      });

      $("apiUrlInput").addEventListener("change", () => {
        saveStorageConfig();
      });

      $("apiTokenInput").addEventListener("change", () => {
        saveStorageConfig();
      });

      $("testConnectionButton").addEventListener("click", async () => {
        saveStorageConfig();
        await checkServerConnection(true);
        await renderHistory();
      });

      $("toggleConnectButton").addEventListener("click", async () => {
        if (state.storageMode === "local") {
          state.storageMode = "auto";
          $("storageMode").value = "auto";
        } else {
          state.storageMode = "local";
          $("storageMode").value = "local";
        }
        saveStorageConfig();
        await checkServerConnection(true);
        await renderHistory();
      });
      $("balanceInput").addEventListener("input", () => {
        readActiveCompany();
        renderOverview();
        renderTabs();
        updateWhatsAppPreview();
        scheduleAutoSave();
      });
      $("balanceInput").addEventListener("blur", () => {
        readActiveCompany();
        $("balanceInput").value = formatCurrencyBR(state.draft.companies[state.activeCompany].balance);
      });

      ["startDate", "endDate", "referenceTime"].forEach((id) => {
        $(id).addEventListener("change", () => {
          readMetadata();
          updateWhatsAppPreview();
          scheduleAutoSave();
        });
      });

      $("searchPaymentsInput").addEventListener("input", (e) => {
        state.filterText = e.target.value;
        renderPayments();
      });
      $("paymentStatusFilter").addEventListener("change", (e) => {
        state.paymentStatusFilter = e.target.value;
        renderPayments();
      });
      $("paymentSort").addEventListener("change", (e) => {
        state.paymentSort = e.target.value;
        renderPayments();
      });
      $("ocrFilterInput").addEventListener("input", (e) => {
        state.ocrFilterText = e.target.value;
        renderOcrPreview();
      });
      $("ocrSort").addEventListener("change", (e) => {
        state.ocrSort = e.target.value;
        renderOcrPreview();
      });

      $("addPaymentButton").addEventListener("click", addPayment);
      $("markAllAuthorizedButton").addEventListener("click", () => markAllCompanyPayments("authorized"));
      $("markAllPaidButton").addEventListener("click", () => markAllCompanyPayments("paid"));
      $("clearCompanyPaymentsButton").addEventListener("click", clearCompanyPayments);

      $("openPrintDialogButton").addEventListener("click", () => {
        document.documentElement.classList.add("dialog-open");
        document.body.classList.add("dialog-open");
        $("printDialog").showModal();
        $("printPasteBox").focus();
      });
      $("closePrintDialogButton").addEventListener("click", () => $("printDialog").close());
      $("printDialog").addEventListener("cancel", (event) => event.preventDefault());
      $("printDialog").addEventListener("close", () => {
        document.documentElement.classList.remove("dialog-open");
        document.body.classList.remove("dialog-open");
      });
      $("selectScreenshotButton").addEventListener("click", () => $("screenshotInput").click());
      $("screenshotInput").addEventListener("change", (event) => {
        if (event.target.files && event.target.files[0]) {
          processScreenshot(event.target.files[0]).catch(showError);
        }
      });

      $("importRecognizedButton").addEventListener("click", () => {
        try { importOcrRows(); } catch (error) { showError(error); }
      });

      $("cancelImportButton").addEventListener("click", () => {
        state.importRows = [];
        $("ocrReview").classList.add("hidden");
        $("printDialog").close();
        $("ocrStatus").textContent = "Importação cancelada.";
      });

      $("newReportButton").addEventListener("click", startNewReport);
      $("saveReportButton").addEventListener("click", () => saveReport().catch(showError));
      $("copyReportButton").addEventListener("click", () => copyWhatsApp().catch(showError));
      $("copyCompanyReportButton").addEventListener("click", () => copyCompanyWhatsApp().catch(showError));
      $("whatsappButton").addEventListener("click", () => {
        try { openWhatsApp(); } catch (error) { showError(error); }
      });
      $("downloadReportButton").addEventListener("click", () => {
        try { downloadWhatsApp(); } catch (error) { showError(error); }
      });
      $("exportCsvButton").addEventListener("click", exportToCSV);

      $("saveCompanyNamesBtn").addEventListener("click", () => saveCompanyNames().catch(showError));
      $("resetCompanyNamesBtn").addEventListener("click", () => resetCompanyNames().catch(showError));

      $("backupExportBtn").addEventListener("click", () => exportBackup().catch(showError));
      $("backupImportBtn").addEventListener("click", () => $("backupImportInput").click());
      $("backupImportInput").addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
          importBackup(e.target.files[0]);
        }
      });

      $("saveHistoryPasswordButton").addEventListener("click", () => setHistoryPassword().catch(showError));
      $("lockHistoryButton").addEventListener("click", lockHistory);

      $("themeToggle").addEventListener("click", toggleTheme);

      initialize();
    })();
  
