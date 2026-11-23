(() => {
      "use strict";

      const DB_NAME = "levfin-db";
      const DB_VERSION = 2;
      const DEFAULT_NAMES = [];
      const AUTOSAVE_KEY = "levfin_autosave_draft_v2";
      const THEME_KEY = "levfin_theme_v2";
      const STORAGE_KEY = "levfin_storage_config_v2";
      const HISTORY_PASSWORD_KEY = "levfin_history_password_hash_v2";
      const APP_CONFIG_KEY = "levfin_app_config_v1";
      const SETTINGS_ACCESS_HASH = "92108843a1596c019f97352dfbf34a4332978343ca546e9bde4dd566f5ddb41c";

      function defaultConfig() {
        return {
          statuses: [
            { id: "pending", label: "✴️ A Autorizar", remittanceRequired: true, countAs: "open" },
            { id: "authorized", label: "✳️ Autorizado", remittanceRequired: false, countAs: "authorized" },
            { id: "paid", label: "✅ Pago", remittanceRequired: false, countAs: "paid" },
            { id: "confirmation", label: "⚠️ Confirmação de Pagamento", remittanceRequired: true, countAs: "open" }
          ],
          remittanceMethods: [
            { id: "standard", label: "✉️ Remessa", requiresDate: true },
            { id: "pix", label: "✉️ Remessa_PIX", requiresDate: true },
            { id: "manual", label: "📝 Lançamento Manual", requiresDate: false },
            { id: "gestao", label: "📝 Lançamento Gestão", requiresDate: false }
          ]
        };
      }
      function normalizeConfig(raw) {
        const base = defaultConfig();
        const cfg = raw && typeof raw === "object" ? raw : {};
        const normList = (list, baseList, mapItem) => {
          if (!Array.isArray(list) || !list.length) return baseList;
          const used = new Set();
          const out = [];
          list.forEach((item, idx) => {
            const mapped = mapItem(item, idx);
            if (!mapped || !mapped.id || used.has(mapped.id)) return;
            used.add(mapped.id); out.push(mapped);
          });
          return out.length ? out : baseList;
        };
        const statuses = normList(cfg.statuses, base.statuses, (item, idx) => {
          const id = String(item?.id || item?.value || ("status_" + (idx + 1))).trim().replace(/[^a-zA-Z0-9_-]/g, "_") || ("status_" + (idx + 1));
          const label = String(item?.label || item?.name || id).trim() || id;
          const countAs = ["open","authorized","paid"].includes(item?.countAs) ? item.countAs : (id === "paid" ? "paid" : id === "authorized" ? "authorized" : "open");
          const remittanceRequired = item?.remittanceRequired !== undefined ? Boolean(item.remittanceRequired) : (countAs === "open");
          return { id, label, remittanceRequired, countAs };
        });
        const remittanceMethods = normList(cfg.remittanceMethods, base.remittanceMethods, (item, idx) => {
          const id = String(item?.id || item?.value || ("method_" + (idx + 1))).trim().replace(/[^a-zA-Z0-9_-]/g, "_") || ("method_" + (idx + 1));
          const label = String(item?.label || item?.name || id).trim() || id;
          const requiresDate = item?.requiresDate !== undefined ? Boolean(item.requiresDate) : !["manual","gestao"].includes(id);
          return { id, label, requiresDate };
        });
        return { statuses, remittanceMethods };
      }

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
        historyUnlocked: false,
        config: defaultConfig(),
        settingsUnlocked: false
      };

      function getCompanyBankName(company) {
        const name = company && (company.bankName ?? company.bank);
        return typeof name === "string" ? name.trim() : "";
      }

      function getStatusConfig(id) {
        const list = (state.config && state.config.statuses) || defaultConfig().statuses;
        return list.find((s) => s.id === id) || list[0];
      }
      function getRemittanceMethodConfig(id) {
        const list = (state.config && state.config.remittanceMethods) || defaultConfig().remittanceMethods;
        return list.find((m) => m.id === id) || null;
      }
      function statusCountAs(id) { return getStatusConfig(id).countAs || "open"; }
      function statusRequiresRemittance(id) { return Boolean(getStatusConfig(id).remittanceRequired); }
      function methodRequiresDate(id) { const m = getRemittanceMethodConfig(id); return m ? Boolean(m.requiresDate) : false; }
      function firstStatusId() { return ((state.config && state.config.statuses && state.config.statuses[0]) || defaultConfig().statuses[0]).id; }
      function firstRemittanceId() { return ((state.config && state.config.remittanceMethods && state.config.remittanceMethods[0]) || defaultConfig().remittanceMethods[0]).id; }
      function statusOptionsHTML(selected) {
        return (state.config.statuses || []).map((s) => `<option value="${escapeHTML(s.id)}"${s.id === selected ? " selected" : ""}>${escapeHTML(s.label)}</option>`).join("");
      }
      function remittanceOptionsHTML(selected, includePlaceholder) {
        const ph = includePlaceholder ? `<option value=""${!selected ? " selected" : ""}>⚠️ Selecione o método</option>` : "";
        return ph + (state.config.remittanceMethods || []).map((m) => `<option value="${escapeHTML(m.id)}"${m.id === selected ? " selected" : ""}>${escapeHTML(m.label)}</option>`).join("");
      }
      function renderStatusFilterOptions() {
        const sel = $("paymentStatusFilter");
        if (!sel) return;
        const current = state.paymentStatusFilter || "all";
        sel.innerHTML = `<option value="all">Todas as situações</option>` + (state.config.statuses || []).map((s) => `<option value="${escapeHTML(s.id)}"${s.id === current ? " selected" : ""}>${escapeHTML(s.label)}</option>`).join("");
        if (![...sel.options].some((o) => o.value === current)) state.paymentStatusFilter = "all";
        sel.value = state.paymentStatusFilter;
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
          companies: state.companies.map((entry) => {
            const obj = entry && typeof entry === "object" ? entry : { name: typeof entry === "string" ? entry : "" };
            return {
              name: typeof obj.name === "string" ? obj.name : "",
              bankName: typeof obj.bankName === "string" ? obj.bankName : (typeof obj.bank === "string" ? obj.bank : ""),
              balance: 0,
              payments: [],
              startDate: "",
              endDate: "",
              referenceTime: ""
            };
          })
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
          request.onupgradeneeded = (event) => {
            const db = request.result;
            const transaction = request.transaction;
            if (db.objectStoreNames.contains("reports") && event.oldVersion < 2) {
              const oldReports = transaction.objectStore("reports");
              if (!oldReports.autoIncrement) {
                const migrationStoreName = "reports_migration";
                if (db.objectStoreNames.contains(migrationStoreName)) db.deleteObjectStore(migrationStoreName);
                const migrationStore = db.createObjectStore(migrationStoreName, { keyPath: "migrationId", autoIncrement: true });
                oldReports.getAll().onsuccess = (oldEvent) => {
                  const records = oldEvent.target.result || [];
                  records.forEach((record) => migrationStore.add({ record }));
                  db.deleteObjectStore("reports");
                  const reports = db.createObjectStore("reports", { keyPath: "id", autoIncrement: true });
                  reports.createIndex("savedAt", "savedAt", { unique: false });
                  migrationStore.getAll().onsuccess = (migrationEvent) => {
                    (migrationEvent.target.result || []).forEach((item) => {
                      const record = { ...item.record };
                      delete record.id;
                      reports.add(record);
                    });
                    db.deleteObjectStore(migrationStoreName);
                  };
                };
              }
            } else if (!db.objectStoreNames.contains("reports")) {
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

      async function authenticateApplication() {
        let password = "";
        if (hasHistoryPassword()) {
          password = window.prompt("Informe a senha para acessar os dados locais do LevFin:");
          if (password === null) throw new Error("Autenticação cancelada.");
        } else {
          password = window.prompt("Crie a senha local do LevFin (mínimo 8 caracteres):");
          if (password === null) throw new Error("Configuração de segurança cancelada.");
          if (password.length < 8) throw new Error("A senha deve ter pelo menos 8 caracteres.");
        }

        const passwordHash = await hashHistoryPassword(password);
        if (hasHistoryPassword() && passwordHash !== localStorage.getItem(HISTORY_PASSWORD_KEY)) {
          throw new Error("Senha local inválida.");
        }
        localStorage.setItem(HISTORY_PASSWORD_KEY, passwordHash);
        state.historyUnlocked = true;
      }

      function lockHistory() {
        state.historyUnlocked = false;
        if (state.draft) {
          state.draft = newDraft();
          state.activeCompany = 0;
          render();
        }
        renderHistory().catch(showError);
        notify("Dados bloqueados nesta sessão.");
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
        if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return "|";
        const [year, month, day] = isoDate.split("-");
        return `${day}/${month}/${year}`;
      }

      function dateShort(isoDate) {
        if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return "|";
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
          const kind = statusCountAs(payment.status);
          if (kind === "paid") {
            totals.paid += amount;
            totals.authorizedOrPaid += amount;
          } else if (kind === "authorized") {
            totals.authorized += amount;
            totals.authorizedOrPaid += amount;
          } else {
            totals.pending += amount;
            totals.forecastOutflow += amount;
          }
          return totals;
        }, { payable: 0, paid: 0, authorized: 0, authorizedOrPaid: 0, pending: 0, forecastOutflow: 0 });
      }

      function paymentRemittanceType(payment) {
        const id = payment && payment.remittanceType;
        if (id && getRemittanceMethodConfig(id)) return id;
        const legacy = String((payment && payment.remittance) || "");
        if (/remessa\s*_?\s*pix/i.test(legacy) && getRemittanceMethodConfig("pix")) return "pix";
        if (/gestao|gestão/i.test(legacy) && getRemittanceMethodConfig("gestao")) return "gestao";
        if (/remessa/i.test(legacy) && getRemittanceMethodConfig("standard")) return "standard";
        if (/manual/i.test(legacy) && getRemittanceMethodConfig("manual")) return "manual";
        const first = (state.config.remittanceMethods || [])[0];
        return first ? first.id : "";
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
        const cfg = getRemittanceMethodConfig(type);
        if (!cfg) return type || "|";
        const base = cfg.label.replace(/^[^\p{L}\p{N}]+/u, "").trim() || cfg.label;
        if (!cfg.requiresDate) return base;
        const date = paymentRemittanceDate(payment);
        return `${base}${date ? ` - ${dateShort(date)}` : ""}`;
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
            // Salva também no histórico automaticamente (mesmo levantamento = sobrescreve)
            scheduleHistoryAutoSave();
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

      function autoAdjustCompanyPeriod(company) {
        if (!company) return;
        const validDates = (company.payments || [])
          .map((p) => p.dueDate)
          .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
          .sort();
        if (!validDates.length) return;
        const minDate = validDates[0];
        const maxDate = validDates[validDates.length - 1];
        company.startDate = minDate;
        company.endDate = maxDate;
        if (state.draft && state.draft.companies[state.activeCompany] === company) {
          $("startDate").value = minDate;
          $("endDate").value = maxDate;
        }
      }

      function updatePeriodFromOcrRows(rows) {
        const dates = rows
          .map((row) => row.dueDate)
          .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
          .sort();
        if (!dates.length) return false;

        const targetCompany = state.draft.companies[state.importCompanyIndex];
        const existingDates = (targetCompany?.payments || [])
          .map((payment) => payment.dueDate)
          .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
        const allDates = [...existingDates, ...dates].sort();
        const startDate = allDates[0];
        const endDate = allDates[allDates.length - 1];

        // Período individual da empresa que está recebendo a importação
        if (targetCompany) {
          targetCompany.startDate = startDate;
          targetCompany.endDate = endDate;
        }
        state.draft.startDate = state.draft.startDate || startDate;
        state.draft.endDate = state.draft.endDate || endDate;
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
          const confidence = row.confidence < 75 ? "Leitura baixa | confira com atenção" : `Confiança ${row.confidence}%`;
          const confidenceClass = row.confidence < 75 ? "import-confidence low" : "import-confidence";

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
                  <option value=""${!row.status ? " selected" : ""}>⚠️ Confirme a situação</option>
                  ${statusOptionsHTML(row.status)}
                </select>
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
            if (field === "dueDate" && methodRequiresDate(state.importRows[index].remittanceType)) {
              state.importRows[index].remittanceDate = input.value;
              const remittanceDateInput = card.querySelector('[data-import-field="remittanceDate"]');
              if (remittanceDateInput) remittanceDateInput.value = input.value;
            }
            if (field === "status") {
              renderOcrPreview();
              return;
            }

            const needsValue = ["dueDate", "amount", "description", "status"].includes(field);
            input.classList.toggle("ocr-field-missing", needsValue && !input.value);
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
        const createdAt = new Date().toISOString();
        if (!company.referenceTime) company.referenceTime = createdAt.slice(11, 16);
        state.importRows.forEach((row, index) => {
          if (!row.dueDate || row.amount === "" || !Number.isFinite(Number(row.amount)) || Number(row.amount) < 0 || !row.description.trim()) {
            throw new Error(`Confira vencimento, valor e fornecedor/histórico do lançamento ${index + 1}.`);
          }
          if (!getStatusConfig(row.status) || !(state.config.statuses || []).some((s) => s.id === row.status)) {
            throw new Error(`Confirme a situação do lançamento ${index + 1}.`);
          }
        });

        company.payments.push(...state.importRows.map(({ dueDate, amount, description, status }) => {
          const needsRem = statusRequiresRemittance(status);
          const method = firstRemittanceId();
          return {
            dueDate,
            amount: Number(amount),
            description: description.trim(),
            status,
            remittanceType: needsRem ? method : "",
            remittanceDate: needsRem && methodRequiresDate(method) ? dueDate : "",
            createdAt
          };
        }));

        autoAdjustCompanyPeriod(company);

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
        renderStatusFilterOptions();
        renderTabs();
        renderPayments();
        renderOverview();
        renderCompanySettings();
        updateWhatsAppPreview();
        renderHistory().catch(showError);
      }

      function renderTabs() {
        $("companyTabs").innerHTML = state.draft.companies.map((company, index) => {
          const pendingCount = (company.payments || []).filter((p) => statusCountAs(p.status) === "open").length;
          const badgeClass = pendingCount > 0 ? "tab-badge has-pending" : "tab-badge";
          const badgeText = pendingCount > 0 ? `${pendingCount} a autorizar` : `${(company.payments || []).length}`;
          return `
            <button type="button" class="company-tab${index === state.activeCompany ? " active" : ""}" data-company="${index}">
              <span>${escapeHTML(company.name || `Empresa ${index + 1}`)}</span>
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
        const companyPeriod = getCompanyPeriod(company);
        $("startDate").value = companyPeriod.startDate || "";
        $("endDate").value = companyPeriod.endDate || "";
        $("referenceTime").value = companyPeriod.referenceTime || "";

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
        // Ordenação inteligente: primeiro por Vencimento, depois por Situação (paid -> authorized -> open), depois pelo Método
        const statusSortOrder = (status) => {
          const cfg = getStatusConfig(status);
          const map = { paid: 0, authorized: 1, open: 2 };
          return map[cfg.countAs] ?? 9;
        };
        const remittanceSortOrder = (payment) => {
          const type = paymentRemittanceType(payment);
          const list = (state.config.remittanceMethods || []).map((m) => m.id);
          const idx = list.indexOf(type);
          return idx === -1 ? 99 : idx;
        };

        paymentsToRender.sort((a, b) => {
          const dateOrder = String(a.dueDate || "").localeCompare(String(b.dueDate || "")) * dateDirection;
          if (dateOrder !== 0) return dateOrder;
          const statusOrder = statusSortOrder(a.status) - statusSortOrder(b.status);
          if (statusOrder !== 0) return statusOrder;
          const remOrder = remittanceSortOrder(a) - remittanceSortOrder(b);
          if (remOrder !== 0) return remOrder;
          return sortRows(a, b, state.paymentSort);
        });

        const dateTotals = new Map();
        const dateByStatus = new Map();
        const dateMethodTotals = new Map();

        paymentsToRender.forEach((payment) => {
          const date = payment.dueDate || "";
          const amount = Number(payment.amount) || 0;
          dateTotals.set(date, (dateTotals.get(date) || 0) + amount);
          if (!dateByStatus.has(date)) dateByStatus.set(date, {});
          const statusMap = dateByStatus.get(date);
          const sid = getStatusConfig(payment.status).id;
          statusMap[sid] = (statusMap[sid] || 0) + amount;

          // Chave de subtotal por dia + situação + método no banco
          const remType = paymentRemittanceType(payment) || "";
          const isRemReq = statusRequiresRemittance(payment.status);
          const methodKey = `${date}__${payment.status}__${isRemReq ? remType : "none"}`;
          dateMethodTotals.set(methodKey, (dateMethodTotals.get(methodKey) || 0) + amount);
        });

        $("paymentRows").innerHTML = paymentsToRender.map((payment, index) => {
          const originalIndex = company.payments.indexOf(payment);
          const statusCfg = getStatusConfig(payment.status);
          const remType = paymentRemittanceType(payment) || firstRemittanceId();
          const needsRemittance = statusRequiresRemittance(statusCfg.id);
          const hidesDate = !needsRemittance || !methodRequiresDate(remType);
          const remClass = hidesDate ? "remittance-cell" : "remittance-cell has-date";
          const isLastOfDate = index === paymentsToRender.length - 1 || paymentsToRender[index + 1].dueDate !== payment.dueDate;
          const currentMethodKey = `${payment.dueDate || ""}__${payment.status}__${needsRemittance ? remType : "none"}`;
          const nextPayment = index < paymentsToRender.length - 1 ? paymentsToRender[index + 1] : null;
          const nextNeedsRem = nextPayment ? statusRequiresRemittance(nextPayment.status) : false;
          const nextRemType = nextPayment ? (paymentRemittanceType(nextPayment) || firstRemittanceId()) : "";
          const nextMethodKey = nextPayment ? `${nextPayment.dueDate || ""}__${nextPayment.status}__${nextNeedsRem ? nextRemType : "none"}` : null;
          const isLastOfMethod = currentMethodKey !== nextMethodKey;

          const methodSubtotal = dateMethodTotals.get(currentMethodKey) || 0;
          const subtotalLabelText = needsRemittance ? `${statusCfg.label} - ${remittanceLabel(payment)}` : `${statusCfg.label}`;
          const subtotalRowHtml = isLastOfMethod ? `
            <tr class="payment-subtotal-method-row">
              <td colspan="6">
                <div class="payment-subtotal-method-content">
                  <span>↳ Subtotal (${escapeHTML(subtotalLabelText)}):</span>
                  <strong>${formatCurrencyBR(methodSubtotal)}</strong>
                </div>
              </td>
            </tr>` : "";
          const dateLabel = payment.dueDate ? dateBR(payment.dueDate) : "Data não informada";
          const statusDisplayOrder = { paid: 0, authorized: 1, open: 2 };
          const statusTotalsHtml = [...(state.config.statuses || [])]
            .sort((a, b) => (statusDisplayOrder[a.countAs] ?? 9) - (statusDisplayOrder[b.countAs] ?? 9))
            .map((s) => {
              const val = (dateByStatus.get(payment.dueDate || "") || {})[s.id] || 0;
              const tone = s.countAs === "paid" ? "tone-paid" : s.countAs === "authorized" ? "tone-authorized" : "tone-open";
              return `<div class="day-total-chip ${tone} clickable-filter" data-status-filter="${escapeHTML(s.id)}" data-status-id="${escapeHTML(s.id)}"><span class="day-total-chip-label">${escapeHTML(s.label)}</span><strong>${formatCurrencyBR(val)}</strong></div>`;
            }).join("");
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
                  ${statusOptionsHTML(statusCfg.id)}
                </select>
              </td>
              <td class="${remClass}" data-label="Método / Remessa">
                ${!needsRemittance ? `<span class="remittance-not-needed" style="font-size: 12px;">${escapeHTML(statusCfg.label)} (não se aplica)</span>` : `
                <select aria-label="Método bancário" data-field="remittanceType">
                  ${remittanceOptionsHTML(remType, false)}
                </select>
                <input aria-label="Data da remessa" type="date" data-field="remittanceDate" value="${escapeHTML(paymentRemittanceDate(payment))}"${hidesDate ? ' class="hidden"' : ""}>`}
              </td>
              <td style="text-align: center;">
                <div class="row-actions">
                  <button type="button" class="action-btn-sm" data-duplicate="${originalIndex}" title="Duplicar este lançamento">📋</button>
                  <button type="button" class="action-btn-sm delete" data-remove="${originalIndex}" title="Remover lançamento">✕</button>
                </div>
              </td>
            </tr>
            ${subtotalRowHtml}
            ${isLastOfDate ? `
            <tr class="payment-date-total" data-day-group="${escapeHTML(payment.dueDate || "")}">
              <td colspan="6">
                <div class="payment-date-total-content">
                  <div class="day-total-title">TOTAIS DE ${escapeHTML(dateLabel)}</div>
                  <div class="day-total-metrics">
                    ${statusTotalsHtml}
                    <div class="day-total-chip is-overall"><span class="day-total-chip-label">Total Geral</span><strong data-day-total="overall">${formatCurrencyBR(dateTotals.get(payment.dueDate || "") || 0)}</strong></div>
                  </div>
                </div>
              </td>
            </tr>` : ""}`;
        }).join("");

        $("emptyPayments").classList.toggle("hidden", paymentsToRender.length > 0);

        $("paymentRows").querySelectorAll("[data-field]").forEach((input) => {
          input.addEventListener("input", updatePaymentFromInput);
          input.addEventListener("change", (event) => {
            updatePaymentFromInput(event);
            const field = event.target.dataset.field;
            if (field === "dueDate" || field === "status" || field === "remittanceType" || field === "remittanceDate") {
              renderPayments();
              renderOverview();
              renderTabs();
              updateWhatsAppPreview();
              scheduleAutoSave();
              return;
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
        const payments = company.payments || [];
        $("paymentRows").querySelectorAll(".payment-date-total").forEach((totalRow) => {
          const dateKey = totalRow.dataset.dayGroup ?? "";
          const dayPayments = payments.filter((p) => (p.dueDate || "") === dateKey);
          const byStatus = {};
          let overall = 0;
          dayPayments.forEach((p) => {
            const amt = Number(p.amount) || 0;
            overall += amt;
            const sid = getStatusConfig(p.status).id;
            byStatus[sid] = (byStatus[sid] || 0) + amt;
          });
          totalRow.querySelectorAll("[data-status-id]").forEach((chip) => {
            const sid = chip.dataset.statusId;
            const strong = chip.querySelector("strong");
            if (strong) strong.textContent = formatCurrencyBR(byStatus[sid] || 0);
          });
          const overallEl = totalRow.querySelector('[data-day-total="overall"]') || totalRow.querySelector("[data-day-total]");
          if (overallEl) overallEl.textContent = formatCurrencyBR(overall);
        });
      }

      function totalsMarkup(company) {
        const totals = paymentTotals(company);
        const balance = Number(company.balance) || 0;
        const open = Math.max(0, (totals.payable || 0) - (totals.paid || 0));
        const finalBalance = balance - open;
        return `
          <div class="totals-grid" aria-label="Resumo financeiro da empresa">
            <div class="totals-item tone-balance"><span class="totals-label">Saldo Inicial</span><span class="totals-value">${formatCurrencyBR(balance)}</span></div>
            <div class="totals-item tone-general"><span class="totals-label">Total Geral</span><span class="totals-value">${formatCurrencyBR(totals.payable)}</span></div>
            <div class="totals-item tone-paid"><span class="totals-label">Total Pago</span><span class="totals-value">${formatCurrencyBR(totals.paid)}</span></div>
            <div class="totals-item tone-open"><span class="totals-label">Total em Aberto</span><span class="totals-value">${formatCurrencyBR(open)}</span></div>
            <div class="totals-item tone-final ${finalBalance < 0 ? "is-negative" : ""}"><span class="totals-label">Saldo Final</span><span class="totals-value">${formatCurrencyBR(finalBalance)}</span></div>
          </div>`;
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
          if (!methodRequiresDate(event.target.value)) {
            payment.remittanceDate = "";
          } else if (!payment.remittanceDate) {
            payment.remittanceDate = payment.dueDate || state.draft.endDate || "";
          }
        } else if (field === "remittanceDate") {
          payment.remittanceDate = event.target.value;
        } else if (field === "status") {
          payment[field] = event.target.value;
          if (!statusRequiresRemittance(payment.status)) {
            payment.remittanceType = "";
            payment.remittanceDate = "";
          } else if (!payment.remittanceType) {
            payment.remittanceType = firstRemittanceId();
            payment.remittanceDate = methodRequiresDate(payment.remittanceType) ? (payment.dueDate || state.draft.endDate || "") : "";
          } else if (!methodRequiresDate(payment.remittanceType)) {
            payment.remittanceDate = "";
          }
        } else {
          payment[field] = event.target.value;
          if (field === "dueDate") {
            if (methodRequiresDate(paymentRemittanceType(payment))) {
              payment.remittanceDate = event.target.value;
              const remittanceDateInput = row.querySelector('[data-field="remittanceDate"]');
              if (remittanceDateInput) remittanceDateInput.value = event.target.value;
            }
            autoAdjustCompanyPeriod(company);
          }
        }

        $("companyTotals").innerHTML = totalsMarkup(company);
        updatePaymentDateTotals();
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
          // Período individual da empresa (lançamento individual)
          company.startDate = $("startDate").value;
          company.endDate = $("endDate").value;
          company.referenceTime = $("referenceTime").value;
        }
      }

      function readMetadata() {
        if (!state.draft) return;
        state.draft.startDate = $("startDate").value;
        state.draft.endDate = $("endDate").value;
        state.draft.referenceTime = $("referenceTime").value;
        // Período individual por empresa (lançamento individual)
        const activeCompany = state.draft.companies[state.activeCompany];
        if (activeCompany) {
          activeCompany.startDate = $("startDate").value;
          activeCompany.endDate = $("endDate").value;
          activeCompany.referenceTime = $("referenceTime").value;
        }
        readActiveCompany();
      }

      function renderOverview() {
        const companies = state.draft.companies;
        const metrics = companies.map((company) => {
          const totals = paymentTotals(company);
          const balance = Number(company.balance) || 0;
          const payable = totals.payable || 0;
          const paid = totals.paid || 0;
          const open = Math.max(0, payable - paid);
          const final = balance - open;
          return { company, balance, payable, paid, open, final };
        });
        const sum = (key) => metrics.reduce((acc, item) => acc + item[key], 0);
        const balance = sum("balance");
        const payable = sum("payable");
        const paid = sum("paid");
        const open = sum("open");
        const final = sum("final");

        const breakdown = (key) => metrics.map((item, index) => `
          <div class="stat-breakdown-row">
            <span title="${escapeHTML(item.company.name || `Empresa ${index + 1}`)}">${escapeHTML(item.company.name || `Empresa ${index + 1}`)}</span>
            <strong>${formatCurrencyBR(item[key])}</strong>
          </div>`).join("");

        $("overallBalance").textContent = formatCurrencyBR(balance);
        $("overallGeneral").textContent = formatCurrencyBR(payable);
        $("overallOpen").textContent = formatCurrencyBR(open);
        $("overallPaid").textContent = formatCurrencyBR(paid);
        $("overallFinal").textContent = formatCurrencyBR(final);
        $("overallFinalCard").classList.toggle("is-negative", final < 0);
        $("overallFinalCard").classList.toggle("is-positive", final >= 0);

        $("balanceByCompany").innerHTML = breakdown("balance");
        $("generalByCompany").innerHTML = breakdown("payable");
        $("openByCompany").innerHTML = breakdown("open");
        $("paidByCompany").innerHTML = breakdown("paid");
        $("finalByCompany").innerHTML = breakdown("final");
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

        // Busca os relatórios do banco local do navegador (IndexedDB)
        try {
          const localReports = await storeRequest("reports", "readonly", (store) => store.getAll());
          if (Array.isArray(localReports)) {
            reports = localReports;
          }
        } catch (err) {
          console.warn("Falha ao buscar histórico local IndexedDB:", err);
        }

        reports.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));

        $("historyList").innerHTML = reports.length ? reports.map((report) => {
          const label = `${dateBR(report.startDate)} a ${dateBR(report.endDate)}`;
          const dateSaved = new Date(report.savedAt).toLocaleString("pt-BR");
          const totalPayments = report.companies.reduce((sum, c) => sum + (c.payments ? c.payments.length : 0), 0);

          return `
            <div class="history-item">
              <div>
                <div class="history-title">📅 Levantamento: ${escapeHTML(label)}</div>
                <div class="history-meta">Salvo em ${escapeHTML(dateSaved)} · ${report.companies.length} empresas · ${totalPayments} lançamento(s)</div>
              </div>
              <div class="history-actions">
                <button class="button small" type="button" data-load="${report.id}">Abrir</button>
                <button class="button small danger" type="button" data-delete="${report.id}">Excluir</button>
              </div>
            </div>`;
        }).join("") : `<div class="empty-history">Nenhum levantamento salvo ainda. Crie o primeiro acima e clique em 'Salvar Levantamento'.</div>`;

        $("historyList").querySelectorAll("[data-load]").forEach((button) => {
          button.addEventListener("click", () => loadReport(Number(button.dataset.load)));
        });
        $("historyList").querySelectorAll("[data-delete]").forEach((button) => {
          button.addEventListener("click", () => deleteReport(Number(button.dataset.delete)));
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
            if (statusRequiresRemittance(payment.status)) {
              if (!getRemittanceMethodConfig(remType)) {
                throw new Error(`Selecione o método no banco/remessa em ${company.name}.`);
              }
              if (methodRequiresDate(remType) && !paymentRemittanceDate(payment)) {
                throw new Error(`Informe a data da remessa de ${company.name}.`);
              }
            }
            if (!payment.dueDate) throw new Error(`Informe o vencimento de todos os lançamentos de ${company.name}.`);
            if (!payment.description.trim()) throw new Error(`Informe a descrição de todos os lançamentos de ${company.name}.`);
          }
        }
      }

      async function saveReport(silent = false) {
        readMetadata();
        if (silent) {
          try { validateDraft(); } catch (_) { return; }
        } else {
          validateDraft();
        }
        const record = JSON.parse(JSON.stringify(state.draft));
        record.savedAt = new Date().toISOString(); delete record._storage;
        const existingLocalId = Number.isInteger(Number(state.draft.id)) && Number(state.draft.id) > 0
          ? Number(state.draft.id)
          : null;

        if (existingLocalId) record.id = existingLocalId;
        else delete record.id;

        state.draft.id = Number(await storeRequest("reports", "readwrite", (store) => existingLocalId ? store.put(record) : store.add(record)));
        state.draft._storage = "local";

        $("saveReportButton").textContent = "💾 Atualizar Levantamento";
        if (!silent) notify("Levantamento salvo com sucesso neste navegador.");
        await renderHistory();
      }

      /* Salvamento Automático no Histórico (mesmo levantamento = sobrescreve; novo = cria) */
      let historyAutoSaveTimer = null;
      function scheduleHistoryAutoSave() {
        clearTimeout(historyAutoSaveTimer);
        historyAutoSaveTimer = setTimeout(() => {
          // Não salva no histórico se não houver nada lançado ainda
          const hasContent = state.draft && state.draft.companies.some((c) =>
            (c.payments || []).length > 0 || (Number(c.balance) || 0) !== 0
          );
          if (!hasContent) return;
          saveReport(true).catch((e) => console.warn("Auto-save do histórico falhou:", e));
        }, 1500);
      }

      function openPdfDialog() {
        const options = $("pdfCompanyOptions");
        options.innerHTML = state.draft.companies.map((company, index) => `
          <label class="pdf-company-option">
            <input type="checkbox" value="${index}" checked>
            <span class="pdf-company-check" aria-hidden="true">✓</span>
            <span class="pdf-company-name">${escapeHTML(company.name || `Empresa ${index + 1}`)}</span>
          </label>`).join("");
        $("pdfDialog").showModal();
      }

      function renderPdfArea(selectedIndexes) {
        readMetadata();
        const companies = state.draft.companies.filter((_, index) => selectedIndexes.includes(index));
        const statusLabel = (payment) => (getStatusConfig(payment.status).label || "").replace(/^[^\p{L}\p{N}]+/u, "").trim() || getStatusConfig(payment.status).label || "";
        const statusClass = (payment) => { const k = statusCountAs(payment.status); return k === "paid" ? "is-paid" : k === "authorized" ? "is-authorized" : "is-pending"; };

        const consolidated = companies.reduce((acc, company) => {
          const totals = paymentTotals(company);
          const balance = Number(company.balance) || 0;
          const open = Math.max(0, (totals.payable || 0) - (totals.paid || 0));
          acc.balance += balance;
          acc.payable += totals.payable || 0;
          acc.paid += totals.paid || 0;
          acc.open += open;
          acc.final += balance - open;
          return acc;
        }, { balance: 0, payable: 0, paid: 0, open: 0, final: 0 });

        const moneyClass = (value) => value < 0 ? "pdf-negative" : "pdf-positive";

        const rowsForDate = (payments) => {
          if (!payments.length) return '<div class="pdf-empty">Sem movimentação.</div>';
          const sorted = [...payments].sort((a, b) => {
            const rank = { paid: 0, authorized: 1, pending: 2, confirmation: 3 };
            return (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
          });
          const line = (payment) => {
            const methodText = statusRequiresRemittance(payment.status)
              ? remittanceLabel(payment)
              : `${getStatusConfig(payment.status).label || statusLabel(payment)} (não se aplica)`;
            return `
            <tr class="${statusClass(payment)}">
              <td class="pdf-col-amount">${escapeHTML(formatCurrencyBR(Number(payment.amount) || 0))}</td>
              <td class="pdf-col-desc">${escapeHTML(payment.description || "Sem descrição")}</td>
              <td class="pdf-col-status"><span class="pdf-status-pill ${statusClass(payment)}">${escapeHTML(statusLabel(payment))}</span></td>
              <td class="pdf-col-method">${escapeHTML(methodText)}</td>
            </tr>`;
          };
          const totalsBy = (list) => list.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
          const pending = payments.filter((p) => statusCountAs(p.status) === "open");
          const settled = payments.filter((p) => statusCountAs(p.status) !== "open");
          const footer = (list, label) => {
            if (!list.length) return "";
            return `<tr class="pdf-subtotal-row"><td colspan="3">${escapeHTML(label)}</td><td class="pdf-col-amount">${formatCurrencyBR(totalsBy(list))}</td></tr>`;
          };
          return `
            <table class="pdf-table">
              <thead><tr><th class="pdf-col-amount">Valor</th><th>Descrição / Fornecedor</th><th class="pdf-col-status">Situação</th><th class="pdf-col-method">Método / Remessa</th></tr></thead>
              <tbody>${sorted.map(line).join("")}</tbody>
              <tfoot>
                ${footer(settled, "Subtotal autorizados/pagos")}
                ${footer(pending, "Subtotal a autorizar/confirmação")}
                <tr class="pdf-total-row"><td colspan="3">Total do dia</td><td class="pdf-col-amount">${formatCurrencyBR(totalsBy(payments))}</td></tr>
              </tfoot>
            </table>`;
        };

        const datesForCompany = (company) => getRelevantPaymentDates(company).map((date) => {
          const payments = (company.payments || []).filter((payment) => payment.dueDate === date);
          return `<div class="pdf-date-group">
            <div class="pdf-date-heading">
              <span>${escapeHTML(dateBR(date))}</span>
              <span class="pdf-date-meta">${payments.length ? `${payments.length} lançamento(s)` : "Sem movimentação"}${payments.length ? ` · ${formatCurrencyBR(payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0))}` : ""}</span>
            </div>
            ${rowsForDate(payments)}
          </div>`;
        }).join("");

        const generatedAt = new Date().toLocaleString("pt-BR");
        $("pdfPrintArea").innerHTML = `
          <header class="pdf-report-header">
            <div>
              <h1>Levantamento Financeiro</h1>
              <p class="pdf-report-subtitle">Período geral: ${escapeHTML(dateBR(state.draft.startDate))} a ${escapeHTML(dateBR(state.draft.endDate))}${state.draft.referenceTime ? ` · ${escapeHTML(state.draft.referenceTime)}` : ""}</p>
            </div>
            <div class="pdf-report-meta">
              <span>${escapeHTML(String(companies.length))} empresa(s)</span>
              <span>Gerado em ${escapeHTML(generatedAt)}</span>
            </div>
          </header>

          <section class="pdf-section-block">
            <h3 class="pdf-section-title">Consolidado</h3>
            <div class="pdf-kpi-row">
              <div class="pdf-kpi-card tone-balance"><span class="pdf-kpi-label">Saldo Atual</span><strong class="pdf-kpi-value">${formatCurrencyBR(consolidated.balance)}</strong></div>
              <div class="pdf-kpi-card tone-general"><span class="pdf-kpi-label">Total Geral</span><strong class="pdf-kpi-value">${formatCurrencyBR(consolidated.payable)}</strong></div>
              <div class="pdf-kpi-card tone-open"><span class="pdf-kpi-label">Total em Aberto</span><strong class="pdf-kpi-value">${formatCurrencyBR(consolidated.open)}</strong></div>
              <div class="pdf-kpi-card tone-paid"><span class="pdf-kpi-label">Total Pago</span><strong class="pdf-kpi-value">${formatCurrencyBR(consolidated.paid)}</strong></div>
              <div class="pdf-kpi-card tone-final ${moneyClass(consolidated.final)}"><span class="pdf-kpi-label">Saldo Final</span><strong class="pdf-kpi-value">${formatCurrencyBR(consolidated.final)}</strong></div>
            </div>
          </section>

          <section class="pdf-company-list">
            ${companies.map((company, index) => {
              const totals = paymentTotals(company);
              const balance = Number(company.balance) || 0;
              const open = Math.max(0, (totals.payable || 0) - (totals.paid || 0));
              const finalBalance = balance - open;
              const companyPeriod = getCompanyPeriod(company);
              return `<article class="pdf-company-section">
                <div class="pdf-company-header">
                  <div>
                    <h2>${index + 1}. ${escapeHTML(company.name || `Empresa ${index + 1}`)}</h2>
                    <p class="pdf-company-period">Período: ${escapeHTML(dateBR(companyPeriod.startDate))} a ${escapeHTML(dateBR(companyPeriod.endDate))}${companyPeriod.referenceTime ? ` · ${escapeHTML(companyPeriod.referenceTime)}` : ""}</p>
                  </div>
                </div>
                <div class="pdf-kpi-row pdf-kpi-row-company">
                  <div class="pdf-kpi-card tone-balance"><span class="pdf-kpi-label">Saldo Atual</span><strong class="pdf-kpi-value">${formatCurrencyBR(balance)}</strong></div>
                  <div class="pdf-kpi-card tone-general"><span class="pdf-kpi-label">Total Geral</span><strong class="pdf-kpi-value">${formatCurrencyBR(totals.payable || 0)}</strong></div>
                  <div class="pdf-kpi-card tone-open"><span class="pdf-kpi-label">Total em Aberto</span><strong class="pdf-kpi-value">${formatCurrencyBR(open)}</strong></div>
                  <div class="pdf-kpi-card tone-paid"><span class="pdf-kpi-label">Total Pago</span><strong class="pdf-kpi-value">${formatCurrencyBR(totals.paid || 0)}</strong></div>
                  <div class="pdf-kpi-card tone-final ${moneyClass(finalBalance)}"><span class="pdf-kpi-label">Saldo Final</span><strong class="pdf-kpi-value">${formatCurrencyBR(finalBalance)}</strong></div>
                </div>
                <div class="pdf-dates">${datesForCompany(company) || '<div class="pdf-empty">Sem lançamentos no período.</div>'}</div>
              </article>`;
            }).join("")}
          </section>`;
        $("pdfPrintArea").classList.remove("hidden");
      }

      function printSelectedCompanies() {
        const selectedIndexes = [...$("pdfCompanyOptions").querySelectorAll("input:checked")].map((input) => Number(input.value));
        if (!selectedIndexes.length) throw new Error("Selecione pelo menos uma empresa para gerar o PDF.");
        renderPdfArea(selectedIndexes);
        $("pdfDialog").close();
        const printWindow = window.open("", "_blank");
        if (!printWindow) throw new Error("O navegador bloqueou a janela de impressão. Permita pop-ups para gerar o PDF.");
        const footerText = "Site Criado por Thiago de Freitas (contato: tfasilva92@gmail.com)";
        const printStyles = `
          @page { size: A4; margin: 10mm 10mm 16mm 10mm; }
          * { box-sizing: border-box; }
          body { margin: 0; color: #10231d; background: #fff; font-family: "Segoe UI", Arial, sans-serif; font-size: 11px; line-height: 1.4; }
          h1 { margin: 0; font-size: 24px; color: #0f2a22; letter-spacing: -.02em; }
          h2 { margin: 0; font-size: 17px; color: #12362b; }
          h3 { margin: 0; }
          p { margin: 0; }
          .pdf-report-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 12px; border-bottom: 2px solid #1d6a4f; margin-bottom: 14px; }
          .pdf-report-subtitle { margin-top: 4px; color: #3f5a50; font-size: 12px; }
          .pdf-report-meta { text-align: right; color: #5b7268; font-size: 10.5px; display: flex; flex-direction: column; gap: 2px; }
          .pdf-section-block { margin-bottom: 14px; }
          .pdf-section-title { font-size: 12px; text-transform: uppercase; letter-spacing: .4px; color: #35584a; margin: 0 0 8px; }
          .pdf-kpi-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
          .pdf-kpi-row-company { margin-bottom: 10px; }
          .pdf-kpi-card { border: 1px solid #d6e2dc; border-radius: 10px; padding: 10px 12px; background: #f7faf8; border-left: 5px solid #9bb8ab; break-inside: avoid; }
          .pdf-kpi-label { display: block; font-size: 10px; color: #4f685d; text-transform: uppercase; letter-spacing: .3px; margin-bottom: 4px; font-weight: 700; }
          .pdf-kpi-value { font-size: 15px; color: #10231d; font-weight: 800; }
          .pdf-kpi-card.tone-balance { background: #eaf3ff; border-color: #bfd4ff; border-left-color: #2563eb; }
          .pdf-kpi-card.tone-balance .pdf-kpi-label, .pdf-kpi-card.tone-balance .pdf-kpi-value { color: #1e40af; }
          .pdf-kpi-card.tone-general { background: #f3f4f6; border-color: #d1d5db; border-left-color: #4b5563; }
          .pdf-kpi-card.tone-general .pdf-kpi-label, .pdf-kpi-card.tone-general .pdf-kpi-value { color: #374151; }
          .pdf-kpi-card.tone-open { background: #fff7e6; border-color: #f2d39b; border-left-color: #d97706; }
          .pdf-kpi-card.tone-open .pdf-kpi-label, .pdf-kpi-card.tone-open .pdf-kpi-value { color: #92400e; }
          .pdf-kpi-card.tone-paid { background: #eafaf0; border-color: #bfe3c9; border-left-color: #16a34a; }
          .pdf-kpi-card.tone-paid .pdf-kpi-label, .pdf-kpi-card.tone-paid .pdf-kpi-value { color: #166534; }
          .pdf-kpi-card.tone-final { background: #eef7f2; border-color: #bddfcd; border-left-color: #15803d; }
          .pdf-kpi-card.tone-final.pdf-negative { background: #fef2f2; border-color: #f3c2c2; border-left-color: #dc2626; }
          .pdf-kpi-card.tone-final.pdf-negative .pdf-kpi-label, .pdf-kpi-card.tone-final.pdf-negative .pdf-kpi-value { color: #991b1b; }
          .pdf-kpi-card.tone-final.pdf-positive .pdf-kpi-label, .pdf-kpi-card.tone-final.pdf-positive .pdf-kpi-value { color: #166534; }
          .pdf-positive { color: #166534; }
          .pdf-negative { color: #991b1b; }
          .pdf-company-list { display: block; }
          .pdf-company-section { margin: 0 0 14px; break-inside: auto; page-break-inside: auto; }
          .pdf-company-header { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; margin-bottom: 8px; padding: 8px 10px; background: #12362b; color: #fff; border-radius: 8px 8px 0 0; break-inside: avoid; page-break-inside: avoid; }
          .pdf-company-header h2 { color: #fff; }
          .pdf-company-period { margin-top: 2px; font-size: 11px; color: #d8ebe3; }
          .pdf-dates { display: block; }
          .pdf-date-group { margin: 8px 0; border: 1px solid #dfe9e3; border-radius: 6px; overflow: hidden; break-inside: auto; page-break-inside: auto; }
          .pdf-date-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 7px 10px; background: #edf5f0; color: #153d31; font-weight: 700; border-bottom: 1px solid #dfe9e3; break-inside: avoid; page-break-inside: avoid; }
          .pdf-date-meta { font-weight: 600; font-size: 10.5px; color: #35584a; }
          .pdf-table { width: 100%; border-collapse: collapse; font-size: 10.5px; table-layout: fixed; }
          .pdf-table th, .pdf-table td { border-bottom: 1px solid #e6ece8; padding: 6px 8px; text-align: left; vertical-align: top; }
          .pdf-table th { background: #f8fbfa; color: #2f4b40; font-size: 10px; text-transform: uppercase; letter-spacing: .25px; }
          .pdf-table tr:last-child td { border-bottom: none; }
          .pdf-col-amount { width: 96px; text-align: right; white-space: nowrap; font-weight: 600; }
          .pdf-col-status { width: 110px; }
          .pdf-col-method { width: 170px; color: #415a51; }
          .pdf-col-desc { word-break: break-word; }
          .pdf-status-pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 9.5px; font-weight: 700; border: 1px solid transparent; }
          .pdf-status-pill.is-paid { background: #e7f6ec; color: #166534; border-color: #b7dec4; }
          .pdf-status-pill.is-authorized { background: #e8f1ff; color: #1d4ed8; border-color: #bfd3ff; }
          .pdf-status-pill.is-pending { background: #fff4db; color: #92400e; border-color: #f2d7a2; }
          .pdf-status-pill.is-confirmation { background: #fce7f3; color: #9d174d; border-color: #f5bfdc; }
          .pdf-subtotal-row td, .pdf-total-row td { background: #f6faf8; font-weight: 700; border-top: 1px solid #d9e6df; }
          .pdf-total-row td { background: #edf5f0; color: #12362b; }
          .pdf-empty { padding: 10px; color: #61786d; font-style: italic; }
          .pdf-page-footer { position: fixed; left: 0; right: 0; bottom: 0; text-align: center; font-size: 9px; color: #5b7268; border-top: 1px solid #dfe9e3; padding: 4px 10mm 0; background: #fff; }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .pdf-table tr, .pdf-date-heading, .pdf-company-header, .pdf-kpi-card { break-inside: avoid; page-break-inside: avoid; }
            thead { display: table-header-group; }
            tfoot { display: table-footer-group; }
          }
        `;
        let printed = false;
        const print = () => {
          if (printed || printWindow.closed) return;
          printed = true;
          printWindow.focus();
          printWindow.print();
        };
        printWindow.document.open();
        printWindow.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Levantamento Financeiro</title><style>${printStyles}</style></head><body><div class="pdf-content">${$("pdfPrintArea").innerHTML}</div><footer class="pdf-page-footer">${footerText}</footer></body></html>`);
        printWindow.document.close();
        printWindow.onload = print;
        window.setTimeout(() => {
          print();
          $("pdfPrintArea").classList.add("hidden");
        }, 400);
      }

      async function loadReport(id, storage = "local") {
        requireHistoryAccess();
        const report = await storeRequest("reports", "readonly", (store) => store.get(id));
        if (!report) throw new Error("Levantamento não encontrado.");
        report._storage = "local";
        report.companies.forEach((company, index) => {
          const entry = state.companies[index];
          if (!company.name || company.name === `Empresa ${index + 1}`) company.name = (entry && typeof entry === "object" ? entry.name : (typeof entry === "string" ? entry : "")) || "";
          if (company.bankName === undefined || company.bankName === null) company.bankName = (entry && typeof entry === "object" ? (entry.bankName || "") : "");
          // Garante período individual por empresa (compatibilidade com relatórios antigos)
          if (company.startDate === undefined) company.startDate = "";
          if (company.endDate === undefined) company.endDate = "";
          if (company.referenceTime === undefined) company.referenceTime = "";
        });
        state.draft = report; state.activeCompany = 0;
        $("saveReportButton").textContent = "💾 Atualizar Levantamento";
        render(); scheduleAutoSave(); notify("Levantamento carregado para consulta ou edição.");
      }

      async function deleteReport(id, storage = "local") {
        requireHistoryAccess();
        if (!window.confirm("Deseja realmente excluir este levantamento salvo? Esta ação não pode ser desfeita.")) return;
        await storeRequest("reports", "readwrite", (store) => store.delete(id));
        if (state.draft.id === id && state.draft._storage === "local") { state.draft.id = null; state.draft._storage = null; $("saveReportButton").textContent = "💾 Salvar Levantamento"; }
        await renderHistory(); notify("Levantamento excluído com sucesso.");
      }

      /* Utilitários de Dias Úteis */
      function parseISODate(isoStr) {
        const [y, m, d] = isoStr.split("-").map(Number);
        return new Date(y, m - 1, d, 12, 0, 0); // Usar meio-dia (12:00) para evitar desvios de fuso horário / horário de verão
      }

      function formatISODate(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      }

      function isBusinessDay(isoStr) {
        if (!isoStr) return false;
        const d = parseISODate(isoStr);
        const dayOfWeek = d.getDay(); // 0 = Domingo, 6 = Sábado
        return dayOfWeek !== 0 && dayOfWeek !== 6;
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

      function formatNoMovementLine(date) {
        return `➡️ *PARA ${dateBR(date)}:* 🆗 Sem movimentação.`;
      }

      function getCompanyPeriod(company) {
        const paymentDates = (company.payments || []).map((p) => p.dueDate).filter(Boolean).sort();
        const firstCreatedPayment = (company.payments || [])
          .filter((payment) => payment.createdAt)
          .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
        const firstCreatedTime = firstCreatedPayment?.createdAt
          ? new Date(firstCreatedPayment.createdAt).toTimeString().slice(0, 5)
          : "";
        // Período individual da empresa tem prioridade; cai para o geral se vazio
        return {
          startDate: company.startDate || paymentDates[0] || state.draft.startDate,
          endDate: company.endDate || paymentDates[paymentDates.length - 1] || state.draft.endDate,
          referenceTime: company.referenceTime || firstCreatedTime || state.draft.referenceTime
        };
      }

      function getRelevantPaymentDates(company) {
        const paymentDates = (company.payments || []).map((p) => p.dueDate).filter(Boolean);
        const period = getCompanyPeriod(company);
        if (!period.startDate || !period.endDate) {
          return [...new Set(paymentDates)].filter((date) => isBusinessDay(date)).sort();
        }

        const minDate = [period.startDate, ...paymentDates].sort()[0];
        const maxDate = [period.endDate, ...paymentDates].sort().reverse()[0];
        // Retorna estritamente os dias úteis (segunda a sexta) no intervalo, ignorando sábados e domingos
        return getBusinessDaysInRange(minDate, maxDate);
      }

      function calculateCompanyObservation(company) {
        const initialBalance = Number(company.balance) || 0;
        const allDates = getRelevantPaymentDates(company);
        const payments = company.payments || [];

        if (!allDates.length || !payments.length) {
          return "✅ *Sem lançamentos previstos no período.*";
        }

        const lines = [];
        let currentBalance = initialBalance;

        allDates.forEach((date, dateIndex) => {
          const dayPayments = payments.filter((p) => p.dueDate === date);
          // Considerar somente autorizados e a autorizar (exclui pagos já debitados)
          const openPayments = dayPayments.filter((p) => statusCountAs(p.status) !== "paid" && (Number(p.amount) || 0) > 0);
          const dayOpenTotal = openPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

          lines.push(`➡️ *PARA ${dateBR(date)}:*`);
          lines.push(`💵 *Total em aberto:* *${formatCurrencyBR(dayOpenTotal)}*`);

          if (openPayments.length === 0) {
            const saldoIcon = currentBalance >= 0 ? "🟢" : "🔴";
            lines.push(`${saldoIcon} *Saldo para a data:* *${formatCurrencyBR(currentBalance)}*`);
            lines.push("📝 *OBS:* Sem pendências para esta data.");
          } else if (currentBalance >= dayOpenTotal) {
            currentBalance -= dayOpenTotal;
            lines.push(`🟢 *Saldo para a data:* *${formatCurrencyBR(currentBalance)}*`);
            lines.push("📝 *OBS:* Saldo suficiente.");
          } else {
            // Saldo insuficiente para pagar o total do dia
            // Ordenar lançamentos por valor crescente para tentar quitar o máximo de parcelas inteiras
            const sortedPayments = openPayments.slice().sort((a, b) => {
              const diff = (Number(a.amount) || 0) - (Number(b.amount) || 0);
              if (diff !== 0) return diff;
              return String(a.description || "").localeCompare(String(b.description || ""), "pt-BR");
            });

            const payableItems = [];
            const pendingItems = [];

            sortedPayments.forEach((p) => {
              const amt = Number(p.amount) || 0;
              if (currentBalance >= amt) {
                currentBalance -= amt;
                payableItems.push(p);
              } else {
                pendingItems.push(p);
              }
            });

            // O saldo final desta data após as deduções possíveis (ou negativo se nada foi coberto)
            const remainingToPay = pendingItems.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
            const deficit = remainingToPay - currentBalance;
            currentBalance = -deficit;

            lines.push(`🔴 *Saldo para a data:* *${formatCurrencyBR(currentBalance)}*`);

            if (payableItems.length > 0) {
              const paidTotal = payableItems.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
              lines.push(`⚠️ *OBS: Saldo parcial* — É possível quitar integralmente *${payableItems.length}* parcela(s) (Total: ${formatCurrencyBR(paidTotal)}), restando *${pendingItems.length}* parcela(s) pendente(s) (Faltam ${formatCurrencyBR(deficit)}).`);
            } else {
              lines.push(`🔴 *OBS: Saldo insuficiente* — Nenhuma parcela pode ser quitada integralmente nesta data (Todas as *${pendingItems.length}* parcelas ficam pendentes; Faltam ${formatCurrencyBR(deficit)}).`);
            }
          }

          if (dateIndex < allDates.length - 1) {
            lines.push(WHATSAPP_SEPARATOR);
          }
        });

        return lines.join("\n");
      }

      function formatCompanyWhatsApp(company, index, includeHeading = true) {
        const lines = [];
        const totals = paymentTotals(company);
        const companyName = company.name.trim() || `Empresa ${index + 1}`;
        const balanceFormatted = formatCurrencyBR(Number(company.balance) || 0);
        const totalPayableNum = Number(totals.payable) || 0;
        const totalPaidNum = Number(totals.paid) || 0;
        const totalOpenNum = Math.max(0, totalPayableNum - totalPaidNum);
        const totalPayable = formatCurrencyBR(totalPayableNum);
        // Lançamentos pagos já foram debitados do saldo Bradesco, portanto não são subtraídos novamente.
        // Considera apenas "A Autorizar" (pending/confirmation) e "Autorizado" (authorized).
        const finalBalance = (Number(company.balance) || 0) - (totals.pending + totals.authorized);

        const saldoFinal = (Number(company.balance) || 0) - totalOpenNum;
        const saldoFinalIcon = saldoFinal >= 0 ? "🟢" : "🔴";

        lines.push(`${index + 1}️⃣ *${companyName}*`);
        lines.push(`🏦 Banco: ${getCompanyBankName(company) || "|"}`);
        lines.push(`💵 Saldo Atual: *${balanceFormatted}*`);
        lines.push(`${saldoFinalIcon} Saldo Final: *${formatCurrencyBR(saldoFinal)}*`);
        lines.push(WHATSAPP_SEPARATOR);
        lines.push(`✴️ Total Geral: *${totalPayable}*`);
        lines.push(`💰 Total Aberto: *${formatCurrencyBR(totalOpenNum)}*`);
        lines.push(`✅ Total Pago: *${formatCurrencyBR(totalPaidNum)}*`);
        lines.push(WHATSAPP_SEPARATOR);
        lines.push("");

        const allDates = getRelevantPaymentDates(company);
        if (allDates.length === 0) {
          const period = getCompanyPeriod(company);
          lines.push(formatNoMovementLine(period.startDate));
          lines.push(WHATSAPP_SEPARATOR);
        } else {
          allDates.forEach((date) => {
            const paymentsForDate = (company.payments || []).filter((p) => p.dueDate === date);
            if (paymentsForDate.length === 0) {
              lines.push(formatNoMovementLine(date));
              lines.push(WHATSAPP_SEPARATOR);
              return;
            }

            const dayPayable = paymentsForDate.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
            const paymentsToDescribe = paymentsForDate.filter((p) => statusRequiresRemittance(p.status));
            const statusDisplayOrder = { paid: 0, authorized: 1, open: 2 };
            const statusLines = [...(state.config.statuses || [])]
              .sort((a, b) => (statusDisplayOrder[a.countAs] ?? 9) - (statusDisplayOrder[b.countAs] ?? 9))
              .map((s) => {
                const val = paymentsForDate.filter((p) => getStatusConfig(p.status).id === s.id).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
                return { s, val };
              });
            const allPaid = dayPayable > 0 && paymentsForDate.every((p) => statusCountAs(p.status) === "paid");

            lines.push(`➡️ *PARA ${dateBR(date)}:*${allPaid ? " ✅" : ""}`);
            lines.push(`💵 *Total a pagar:* *${formatCurrencyBR(dayPayable)}*`);
            statusLines.forEach(({ s, val }) => {
              if (val > 0) lines.push(`${s.label}: *${formatCurrencyBR(val)}*`);
            });

            const groups = {};
            paymentsToDescribe.forEach((payment) => {
              const type = paymentRemittanceType(payment);
              const remittanceDate = methodRequiresDate(type) ? paymentRemittanceDate(payment) : "";
              const key = `${type}_${remittanceDate}`;
              if (!groups[key]) groups[key] = { type, remittanceDate, items: [] };
              groups[key].items.push(payment);
            });

            const remOrder = (state.config.remittanceMethods || []).map((m) => m.id);
            Object.values(groups)
              .sort((a, b) => (remOrder.indexOf(a.type) === -1 ? 99 : remOrder.indexOf(a.type)) - (remOrder.indexOf(b.type) === -1 ? 99 : remOrder.indexOf(b.type)))
              .forEach((group) => {
              const groupTotal = group.items.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
              const mcfg = getRemittanceMethodConfig(group.type);
              const typeLabel = mcfg ? mcfg.label : (group.type || "Método");
              const needsDate = mcfg ? mcfg.requiresDate : ["standard","pix"].includes(group.type);
              const dateLabel = needsDate && group.remittanceDate ? ` ${dateShort(group.remittanceDate)}` : "";
              lines.push("");
              lines.push(`*${typeLabel}${dateLabel}* | *${formatCurrencyBR(groupTotal)}*`);
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

      function formatWhatsAppPeriodHeader(company = null) {
        const period = company ? getCompanyPeriod(company) : state.draft;
        const start = dateBR(period.startDate);
        const end = dateBR(period.endDate);
        const now = new Date();
        const nowDay = String(now.getDate()).padStart(2, "0");
        const nowMonth = String(now.getMonth() + 1).padStart(2, "0");
        const nowYear = String(now.getFullYear()).slice(-2);
        const nowHours = String(now.getHours()).padStart(2, "0");
        const nowMinutes = String(now.getMinutes()).padStart(2, "0");
        const dateTimeStr = `${nowDay}/${nowMonth}/${nowYear} | ${nowHours}:${nowMinutes}`;

        const periodDatesStr = (start && end && start !== "|" && end !== "|")
          ? (start === end ? start : `${start} a ${end}`)
          : (start !== "|" ? start : (end !== "|" ? end : "A definir"));

        return [
          "*Levantamento de Pagamentos*",
          `🕒 *Data/hora do levantamento:* ${dateTimeStr}`,
          `📅 *Datas Analisadas:* ${periodDatesStr}`
        ];
      }

      function formatWhatsApp() {
        if (!state.draft) return "";
        readMetadata();
        const lines = [];
        state.draft.companies.forEach((company, index) => {
          if (index === 0) {
            lines.push(...formatWhatsAppPeriodHeader(company));
            lines.push("");
          }
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
            lines.push(formatNoMovementLine(state.draft.startDate));
            lines.push("------------------------------------------------");
          } else {
            allDates.forEach((date) => {
              const paymentsForDate = (company.payments || []).filter((p) => p.dueDate === date);

              if (paymentsForDate.length === 0) {
                lines.push(formatNoMovementLine(date));
                lines.push("------------------------------------------------");
              } else {
                const dayPayable = paymentsForDate.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
                const dayAuthorized = paymentsForDate
                  .filter((p) => statusCountAs(p.status) === "authorized")
                  .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
                const dayPaid = paymentsForDate
                  .filter((p) => statusCountAs(p.status) === "paid")
                  .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
                const dayPending = paymentsForDate
                  .filter((p) => statusCountAs(p.status) === "open")
                  .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
                const hasConfirmation = false;

                const dateTag = hasConfirmation ? " (CONFIRMAÇÃO DE PAGAMENTO)" : "";
                lines.push(`➡️ *PARA ${dateBR(date)}:*${dateTag}`);
                lines.push(`💵 *Total A Pagar:* ${formatCurrencyBR(dayPayable)}`);
                lines.push(`💚 *Total Pago:* ${formatCurrencyBR(dayPaid)}`);
                lines.push(`✳️ *Total Autorizado:* ${formatCurrencyBR(dayAuthorized)}`);
                lines.push(`✴️ *Total a Autorizar:* ${formatCurrencyBR(dayPending)}`);

                // Agrupamento inteligente por Método / Remessa
                const groups = {};
                paymentsForDate.forEach((p) => {
                  const type = paymentRemittanceType(p);
                  const rDate = methodRequiresDate(type) ? paymentRemittanceDate(p) : "";
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
                    lines.push(`✉️ *Remessa${dStr} | ${totalStr}:*`);
                  } else if (group.type === "pix") {
                    const dStr = group.rDate ? ` ${dateShort(group.rDate)}` : "";
                    lines.push(`✉️ *Remessa_PIX${dStr} | ${totalStr}:*`);
                  } else if (group.type === "gestao") {
                    lines.push(`📝 *Lançamento Gestão | ${totalStr}*`);
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

          // Lançamentos pagos já foram debitados do saldo; considera apenas pendentes + autorizados
          const forecast = (Number(company.balance) || 0) - (totals.pending + totals.authorized);
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
        const header = state.activeCompany === 0 ? [...formatWhatsAppPeriodHeader(company), ""] : [];
        const text = [...header, ...formatCompanyWhatsApp(company, state.activeCompany)].join("\n");
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
        // Cabeçalho "Levantamento de Pagamento de ... a ..." em caixa separada (colagem individual)
        $("companyWhatsAppHeader").textContent = formatWhatsAppPeriodHeader(company).join("\n");
        $("companyWhatsAppPreview").textContent = formatCompanyWhatsApp(company, state.activeCompany).join("\n");
        
        const obsBox = $("companyWhatsAppObservation");
        if (obsBox) {
          obsBox.textContent = calculateCompanyObservation(company);
        }
      }

      /* Ao clicar na caixa e pressionar Ctrl+A (ou Cmd+A), seleciona apenas o conteúdo dessa caixa */
      function setupPreviewTextSelection() {
        const selectBoxContent = (box) => {
          const range = document.createRange();
          range.selectNodeContents(box);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        };

        ["companyWhatsAppHeader", "companyWhatsAppPreview", "companyWhatsAppObservation"].forEach((id) => {
          const box = $(id);
          if (!box) return;
          box.setAttribute("tabindex", "0");
          box.style.userSelect = "text";
          box.addEventListener("click", () => box.focus());
          box.addEventListener("keydown", (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "a") {
              event.preventDefault();
              selectBoxContent(box);
            }
          });
        });
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
            const statusText = (getStatusConfig(p.status).label || p.status || "");

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
        const createdAt = new Date().toISOString();
        if (!company.referenceTime) company.referenceTime = createdAt.slice(11, 16);
        const defStatus = (state.config.statuses.find((s) => s.id === "pending") || state.config.statuses[0] || { id: "pending" }).id;
        const defMethod = firstRemittanceId();
        company.payments.push({
          dueDate: "",
          amount: "",
          description: "",
          status: defStatus,
          remittanceType: statusRequiresRemittance(defStatus) ? defMethod : "",
          remittanceDate: "",
          createdAt
        });
        autoAdjustCompanyPeriod(company);
        renderPayments();
        renderTabs();
        renderOverview();
        updateWhatsAppPreview();
        scheduleAutoSave();

        const rows = $("paymentRows").querySelectorAll("tr");
        if (rows.length) {
          const lastRow = rows[rows.length - 1];
          const dateInput = lastRow.querySelector('[data-field="dueDate"]');
          if (dateInput) dateInput.focus();
        }
      }

      function markAllCompanyPayments(newStatus) {
        readActiveCompany();
        const company = state.draft.companies[state.activeCompany];
        if (!company.payments.length) return;
        company.payments.forEach((p) => {
          p.status = newStatus;
          if (!statusRequiresRemittance(p.status)) {
            p.remittanceType = "";
            p.remittanceDate = "";
          } else if (!p.remittanceType) {
            p.remittanceType = firstRemittanceId();
            p.remittanceDate = methodRequiresDate(p.remittanceType) ? (p.dueDate || "") : "";
          } else if (!methodRequiresDate(p.remittanceType)) {
            p.remittanceDate = "";
          }
        });
        renderPayments();
        renderTabs();
        renderOverview();
        updateWhatsAppPreview();
        scheduleAutoSave();
        notify(`Todos os lançamentos de ${company.name} foram marcados como ${getStatusConfig(newStatus).label}.`);
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

      /* Acesso e Configurações do Sistema */
      function updateSettingsAccessUI() {
        const content = $("settingsContent");
        if (!content) return;
        content.classList.toggle("hidden", !state.settingsUnlocked);
        let gate = $("settingsGate");
        if (!gate && content.parentElement) {
          gate = document.createElement("div");
          gate.id = "settingsGate";
          gate.className = "settings-gate";
          gate.innerHTML = `
            <div class="settings-gate-card">
              <div class="settings-gate-icon" aria-hidden="true">🔒</div>
              <div class="settings-gate-body">
                <h4 class="settings-gate-title">Acesso às configurações</h4>
                <p class="settings-gate-description">Digite a senha para visualizar e editar as configurações do sistema.</p>
                <label class="settings-gate-label" for="settingsAccessPassword">Senha</label>
                <div class="settings-gate-row">
                  <div class="password-field settings-gate-password">
                    <input id="settingsAccessPassword" type="password" placeholder="Digite sua senha" autocomplete="current-password">
                    <button type="button" class="password-toggle" data-target="settingsAccessPassword" aria-label="Mostrar senha" title="Mostrar senha">👁</button>
                  </div>
                  <button class="button primary" id="unlockSettingsBtn" type="button">Desbloquear</button>
                </div>
              </div>
            </div>`;
          content.parentElement.insertBefore(gate, content);
          $("unlockSettingsBtn").addEventListener("click", () => unlockSettingsAccess().catch(showError));
          $("settingsAccessPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") unlockSettingsAccess().catch(showError); });
        }
        if (gate) gate.classList.toggle("hidden", state.settingsUnlocked);
        if (state.settingsUnlocked) {
          renderAppConfigSettings();
        }
      }
      async function unlockSettingsAccess() {
        const input = $("settingsAccessPassword");
        const value = input ? input.value : "";
        const hash = await hashHistoryPassword(value);
        if (hash !== SETTINGS_ACCESS_HASH) throw new Error("Senha das configurações inválida.");
        state.settingsUnlocked = true;
        if (input) input.value = "";
        updateSettingsAccessUI();
        notify("Configurações desbloqueadas.");
      }
      function setupSettingsAccess() {
        const details = $("settingsDetails");
        if (!details) return;
        details.addEventListener("toggle", () => {
          if (details.open && !state.settingsUnlocked) {
            updateSettingsAccessUI();
            setTimeout(() => { const i = $("settingsAccessPassword"); if (i) i.focus(); }, 0);
          } else {
            updateSettingsAccessUI();
          }
        });
        updateSettingsAccessUI();
      }

      const STATUS_ID_OPTIONS = [
        { id: "pending", label: "A Autorizar" },
        { id: "authorized", label: "Autorizado" },
        { id: "paid", label: "Pago" },
        { id: "confirmation", label: "Confirmação de Pagamento" }
      ];
      const REMITTANCE_ID_OPTIONS = [
        { id: "standard", label: "Remessa" },
        { id: "pix", label: "Remessa PIX" },
        { id: "manual", label: "Lançamento Manual" },
        { id: "gestao", label: "Lançamento Gestão" }
      ];
      function statusIdOptionsHTML(selected, usedIds) {
        const opts = [...STATUS_ID_OPTIONS];
        if (selected && !opts.some((o) => o.id === selected)) opts.push({ id: selected, label: `Personalizado (${selected})` });
        return opts.map((o) => {
          const disabled = usedIds && usedIds.has(o.id) && o.id !== selected ? " disabled" : "";
          return `<option value="${escapeHTML(o.id)}"${o.id === selected ? " selected" : ""}${disabled}>${escapeHTML(o.label)}</option>`;
        }).join("");
      }
      function remittanceIdOptionsHTML(selected, usedIds) {
        const opts = [...REMITTANCE_ID_OPTIONS];
        if (selected && !opts.some((o) => o.id === selected)) opts.push({ id: selected, label: `Personalizado (${selected})` });
        return opts.map((o) => {
          const disabled = usedIds && usedIds.has(o.id) && o.id !== selected ? " disabled" : "";
          return `<option value="${escapeHTML(o.id)}"${o.id === selected ? " selected" : ""}${disabled}>${escapeHTML(o.label)}</option>`;
        }).join("");
      }

      function configStatusRow(status, index) {
        const usedIds = new Set((state.config.statuses || []).map((s) => s.id));
        return `
          <div class="config-row status-row" data-status-index="${index}">
            <div><label>Rótulo</label><input type="text" data-cfg="label" value="${escapeHTML(status.label || "")}"></div>
            <div><label>Conta como</label><select data-cfg="countAs">
              <option value="open"${status.countAs === "open" ? " selected" : ""}>Em aberto</option>
              <option value="authorized"${status.countAs === "authorized" ? " selected" : ""}>Autorizado</option>
              <option value="paid"${status.countAs === "paid" ? " selected" : ""}>Pago</option>
            </select></div>
            <div><label>Método/Remessa</label><select data-cfg="remittanceRequired">
              <option value="true"${status.remittanceRequired ? " selected" : ""}>Obrigatório</option>
              <option value="false"${!status.remittanceRequired ? " selected" : ""}>Não se aplica</option>
            </select></div>
            <div><label>Identificador (ID)</label><select data-cfg="id">${statusIdOptionsHTML(status.id, usedIds)}</select></div>
            <div><button class="button small danger" type="button" data-remove-status="${index}" title="Excluir">✕</button></div>
          </div>`;
      }
      function configRemittanceRow(method, index) {
        const usedIds = new Set((state.config.remittanceMethods || []).map((m) => m.id));
        return `
          <div class="config-row remittance-row" data-remittance-index="${index}">
            <div><label>Rótulo</label><input type="text" data-cfg="label" value="${escapeHTML(method.label || "")}"></div>
            <div><label>Exige data da remessa</label><select data-cfg="requiresDate">
              <option value="true"${method.requiresDate ? " selected" : ""}>Sim</option>
              <option value="false"${!method.requiresDate ? " selected" : ""}>Não</option>
            </select></div>
            <div><label>Identificador (ID)</label><select data-cfg="id">${remittanceIdOptionsHTML(method.id, usedIds)}</select></div>
            <div><button class="button small danger" type="button" data-remove-remittance="${index}" title="Excluir">✕</button></div>
          </div>`;
      }
      function renderAppConfigSettings() {
        const sl = $("statusConfigList");
        if (sl) {
          sl.innerHTML = (state.config.statuses || []).map(configStatusRow).join("");
          sl.querySelectorAll("[data-remove-status]").forEach((btn) => btn.addEventListener("click", () => {
            const idx = Number(btn.dataset.removeStatus);
            if ((state.config.statuses || []).length <= 1) return notify("Mantenha pelo menos uma situação.", true);
            state.config.statuses.splice(idx, 1);
            renderAppConfigSettings();
          }));
        }
        const rl = $("remittanceConfigList");
        if (rl) {
          rl.innerHTML = (state.config.remittanceMethods || []).map(configRemittanceRow).join("");
          rl.querySelectorAll("[data-remove-remittance]").forEach((btn) => btn.addEventListener("click", () => {
            const idx = Number(btn.dataset.removeRemittance);
            if ((state.config.remittanceMethods || []).length <= 1) return notify("Mantenha pelo menos um método.", true);
            state.config.remittanceMethods.splice(idx, 1);
            renderAppConfigSettings();
          }));
        }
      }
      function readAppConfigFromUI() {
        const statuses = [];
        const seenStatus = new Set();
        $("statusConfigList")?.querySelectorAll(".status-row").forEach((row) => {
          const id = row.querySelector('[data-cfg="id"]').value.trim();
          const label = row.querySelector('[data-cfg="label"]').value.trim() || id;
          const countAs = row.querySelector('[data-cfg="countAs"]').value;
          const remittanceRequired = row.querySelector('[data-cfg="remittanceRequired"]').value === "true";
          if (id && !seenStatus.has(id)) { seenStatus.add(id); statuses.push({ id, label, countAs, remittanceRequired }); }
        });
        const remittanceMethods = [];
        const seenMethod = new Set();
        $("remittanceConfigList")?.querySelectorAll(".remittance-row").forEach((row) => {
          const id = row.querySelector('[data-cfg="id"]').value.trim();
          const label = row.querySelector('[data-cfg="label"]').value.trim() || id;
          const requiresDate = row.querySelector('[data-cfg="requiresDate"]').value === "true";
          if (id && !seenMethod.has(id)) { seenMethod.add(id); remittanceMethods.push({ id, label, requiresDate }); }
        });
        return normalizeConfig({ statuses, remittanceMethods });
      }
      async function saveAppConfig() {
        if (!state.settingsUnlocked) throw new Error("Desbloqueie as configurações para salvar.");
        state.config = readAppConfigFromUI();
        await storeRequest("settings", "readwrite", (store) => store.put({ key: APP_CONFIG_KEY, value: state.config }));
        renderStatusFilterOptions();
        renderPayments();
        renderOverview();
        updateWhatsAppPreview();
        scheduleAutoSave();
        notify("Configurações salvas.");
      }
      async function resetAppConfig() {
        if (!state.settingsUnlocked) throw new Error("Desbloqueie as configurações para restaurar.");
        if (!window.confirm("Restaurar situações e métodos para o padrão?")) return;
        state.config = defaultConfig();
        await storeRequest("settings", "readwrite", (store) => store.put({ key: APP_CONFIG_KEY, value: state.config }));
        renderStatusFilterOptions();
        renderPayments();
        renderOverview();
        updateWhatsAppPreview();
        renderAppConfigSettings();
        scheduleAutoSave();
        notify("Configurações restauradas para o padrão.");
      }
      function addStatusConfig() {
        if (!state.settingsUnlocked) return;
        const used = new Set((state.config.statuses || []).map((s) => s.id));
        const next = STATUS_ID_OPTIONS.find((o) => !used.has(o.id));
        if (!next) return notify("Todas as situações disponíveis já foram adicionadas.", true);
        state.config.statuses.push({ id: next.id, label: next.label, remittanceRequired: next.id === "pending" || next.id === "confirmation", countAs: next.id === "paid" ? "paid" : next.id === "authorized" ? "authorized" : "open" });
        renderAppConfigSettings();
      }
      function addRemittanceConfig() {
        if (!state.settingsUnlocked) return;
        const used = new Set((state.config.remittanceMethods || []).map((m) => m.id));
        const next = REMITTANCE_ID_OPTIONS.find((o) => !used.has(o.id));
        if (!next) return notify("Todos os métodos disponíveis já foram adicionados.", true);
        state.config.remittanceMethods.push({ id: next.id, label: next.label, requiresDate: next.id === "standard" || next.id === "pix" });
        renderAppConfigSettings();
      }

      /* Configuração dos Nomes das Empresas */
      function renderCompanySettings() {
        const grid = $("settingsGrid");
        grid.innerHTML = state.companies.map((entry, index) => {
          const company = entry && typeof entry === "object" ? entry : { name: typeof entry === "string" ? entry : "", bankName: "" };
          const draftComp = state.draft && state.draft.companies && state.draft.companies[index];
          const currentBank = company.bankName || (draftComp && (draftComp.bankName || draftComp.bank)) || "";
          return `
          <div class="field company-config-field">
            <label for="companyNameInput_${index}">Empresa ${index + 1}</label>
            <input type="text" id="companyNameInput_${index}" data-company-name-index="${index}" value="${escapeHTML(company.name || (draftComp && draftComp.name) || "")}" placeholder="Nome da empresa">
            <label for="companyBankInput_${index}" style="margin-top:8px;">Banco da empresa ${index + 1}</label>
            <input type="text" id="companyBankInput_${index}" data-company-bank-index="${index}" value="${escapeHTML(currentBank)}" placeholder="Ex.: Bradesco">
          </div>`;
        }).join("");
        updateSettingsAccessUI();
      }

      async function saveCompanyNames() {
        const inputs = $("settingsGrid").querySelectorAll("[data-company-name-index]");
        const newCompanies = [];
        inputs.forEach((input) => {
          const idx = Number(input.dataset.companyNameIndex);
          const name = input.value.trim();
          const bankInput = $("settingsGrid").querySelector(`[data-company-bank-index="${idx}"]`);
          const bankName = bankInput ? bankInput.value.trim() : ((state.companies[idx] && state.companies[idx].bankName) || "");
          newCompanies.push({ name, bankName });
        });
        state.companies = newCompanies;
        if (state.draft && state.draft.companies) {
          state.draft.companies.forEach((comp, idx) => {
            const entry = state.companies[idx] || { name: "", bankName: "" };
            comp.name = entry.name;
            comp.bankName = entry.bankName;
          });
        }
        await storeRequest("settings", "readwrite", (store) => store.put({ key: "companyNames", value: state.companies }));
        renderTabs();
        updateWhatsAppPreview();
        scheduleAutoSave();
        notify("Empresas e bancos atualizados com sucesso!");
      }

      function addCompany() {
        readActiveCompany();
        state.companies.push({ name: "", bankName: "" });
        state.draft.companies.push({ name: "", bankName: "", balance: 0, payments: [], startDate: "", endDate: "", referenceTime: "" });
        renderCompanySettings();
        renderTabs();
        scheduleAutoSave();
      }

      async function resetCompanyNames() {
        if (!window.confirm("Restaurar empresas e bancos para o padrão?")) return;
        state.companies = [{ name: "", bankName: "" }];
        state.draft.companies.forEach((comp) => { comp.name = ""; comp.bankName = ""; });
        state.activeCompany = Math.min(state.activeCompany, Math.max(0, state.draft.companies.length - 1));
        await storeRequest("settings", "readwrite", (store) => store.put({ key: "companyNames", value: state.companies }));
        renderCompanySettings();
        renderTabs();
        updateWhatsAppPreview();
        scheduleAutoSave();
        notify("Empresas e bancos restaurados para o padrão.");
      }

      /* Backup e Restauração */
      async function exportBackup() {
        requireHistoryAccess();
        const reports = await storeRequest("reports", "readonly", (store) => store.getAll());
        const settings = await storeRequest("settings", "readonly", (store) => store.getAll());
        const backupData = {
          app: "LevFin",
          version: "2.2",
          exportedAt: new Date().toISOString(),
          companies: state.companies,
          config: state.config,
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
          if (Array.isArray(data.companies) && data.companies.length > 0) {
            state.companies = data.companies.map((item) => item && typeof item === "object"
              ? { name: typeof item.name === "string" ? item.name : "", bankName: typeof item.bankName === "string" ? item.bankName : (typeof item.bank === "string" ? item.bank : "") }
              : { name: typeof item === "string" ? item : "", bankName: "" });
            await storeRequest("settings", "readwrite", (store) => store.put({ key: "companyNames", value: state.companies }));
          }
          if (data.config) {
            state.config = normalizeConfig(data.config);
            await storeRequest("settings", "readwrite", (store) => store.put({ key: APP_CONFIG_KEY, value: state.config }));
          }
          render();
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
        } else if (saved === "light") {
          document.documentElement.setAttribute("data-theme", "light");
        } else if (!saved && window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
          document.documentElement.setAttribute("data-theme", "light");
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

        const handlePasteImage = (event) => {
          const clipboardData = event.clipboardData || window.clipboardData;
          if (!clipboardData) return;

          // 1. Tentar pegar por items (mais comum para imagens copiadas com Print Screen / Ctrl+C)
          const items = clipboardData.items;
          let imageFile = null;
          if (items) {
            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              if (item.type && item.type.startsWith("image/")) {
                imageFile = item.getAsFile();
                if (imageFile) break;
              }
            }
          }

          // 2. Fallback para clipboardData.files (caso venha como arquivo colado)
          if (!imageFile && clipboardData.files && clipboardData.files.length > 0) {
            for (let i = 0; i < clipboardData.files.length; i++) {
              const file = clipboardData.files[i];
              if (file.type && file.type.startsWith("image/")) {
                imageFile = file;
                break;
              }
            }
          }

          if (imageFile) {
            event.preventDefault();
            event.stopPropagation();
            // Se o modal do print não estiver aberto, abre para exibir o progresso e a conferência
            const dialog = $("printDialog");
            if (dialog && !dialog.open) {
              document.documentElement.classList.add("dialog-open");
              document.body.classList.add("dialog-open");
              dialog.showModal();
            }
            notify("Imagem capturada da área de transferência! Processando OCR...");
            processScreenshot(imageFile).catch(showError);
          }
        };

        // Permite colar tanto dentro da caixa de print quanto globalmente na tela
        if (pasteBox) {
          pasteBox.addEventListener("paste", handlePasteImage);
          pasteBox.addEventListener("click", (event) => {
            if (event.target === pasteBox || event.target.tagName !== "BUTTON") pasteBox.focus();
          });
        }

        // Listener global de paste no documento (se copiar um print e apertar Ctrl+V em qualquer lugar da tela)
        window.addEventListener("paste", (event) => {
          // Se o usuário estiver digitando em um input de texto ou textarea, não interceptar a menos que seja imagem
          const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
          const isTextInput = (activeTag === "input" && !["button", "checkbox", "radio"].includes(document.activeElement.type)) || activeTag === "textarea";
          
          const clipboardData = event.clipboardData || window.clipboardData;
          const hasImage = clipboardData && Array.from(clipboardData.items || []).some((item) => item.type && item.type.startsWith("image/"));
          
          if (hasImage) {
            handlePasteImage(event);
          }
        });

        const dropZone = $("importDropZone");
        if (dropZone) {
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
            e.preventDefault();
            dropZone.classList.remove("dragover");
            const files = e.dataTransfer?.files;
            if (files && files.length > 0) {
              for (let i = 0; i < files.length; i++) {
                if (files[i].type && files[i].type.startsWith("image/")) {
                  processScreenshot(files[i]).catch(showError);
                  break;
                }
              }
            }
          });
        }
      }

      /* Inicialização Geral da Aplicação */
      async function initialize() {
        initTheme();
        try {
          state.db = await openDatabase();

          let savedNames = [];
          const savedSettings = await storeRequest("settings", "readonly", (store) => store.get("companyNames"));
          if (savedSettings && Array.isArray(savedSettings.value)) {
            savedNames = savedSettings.value;
          }

          state.companies = savedNames.length
            ? savedNames.map((item) => {
                if (item && typeof item === "object") {
                  return { name: typeof item.name === "string" ? item.name.trim() : "", bankName: typeof item.bankName === "string" ? item.bankName.trim() : (typeof item.bank === "string" ? item.bank.trim() : "") };
                }
                return { name: typeof item === "string" ? item.trim() : "", bankName: "" };
              })
            : [{ name: "", bankName: "" }];

          if (JSON.stringify(savedNames) !== JSON.stringify(state.companies)) {
            await storeRequest("settings", "readwrite", (store) => store.put({ key: "companyNames", value: state.companies }));
          }

          const savedAppConfig = await storeRequest("settings", "readonly", (store) => store.get(APP_CONFIG_KEY)).catch(() => null);
          if (savedAppConfig && savedAppConfig.value) state.config = normalizeConfig(savedAppConfig.value);

          const autoSaved = loadAutoSavedDraft();
          if (autoSaved) {
            state.draft = autoSaved;
            state.draft.companies.forEach((comp, idx) => {
              const entry = state.companies[idx];
              if (entry) {
                if (entry.name) comp.name = entry.name;
                if (entry.bankName) comp.bankName = entry.bankName;
              }
              if (comp.bankName === undefined) comp.bankName = "";
              if (comp.startDate === undefined) comp.startDate = "";
              if (comp.endDate === undefined) comp.endDate = "";
              if (comp.referenceTime === undefined) comp.referenceTime = "";
            });
            const indicator = $("autoSaveIndicator");
            if (indicator) indicator.textContent = "⚡ Rascunho restaurado";
          } else {
            state.draft = newDraft();
          }
          state.historyUnlocked = true;
          state.settingsUnlocked = false;
          const sd = $("settingsDetails");
          if (sd) sd.open = false;

          render();
          setupSettingsAccess();
          setupClipboardAndDropZone();
        } catch (error) {
          showError(error);
          const historyList = $("historyList");
          if (historyList) historyList.innerHTML = '<div class="empty-history">O armazenamento não pôde ser iniciado.</div>';
        }
      }

      /* Event Listeners */
      $("balanceInput").addEventListener("input", () => {
        readActiveCompany();
        if ($("companyTotals")) $("companyTotals").innerHTML = totalsMarkup(state.draft.companies[state.activeCompany]);
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
        $(id).addEventListener("change", (event) => {
          const value = event.target.value;
          if ((id === "startDate" || id === "endDate") && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
          if (id === "referenceTime" && value && !/^\d{2}:\d{2}$/.test(value)) return;
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

      /* Filtro interativo pelos subtotais de status (linha de total do dia) */
      $("paymentRows").addEventListener("click", (e) => {
        const chip = e.target.closest(".clickable-filter");
        if (!chip) return;
        const status = chip.dataset.statusFilter;
        if (!status) return;
        state.paymentStatusFilter = status;
        $("paymentStatusFilter").value = status;
        renderPayments();
      });

      $("paymentRows").addEventListener("focusin", (e) => {
        if (e.target.matches('td:nth-child(4) select, .remittance-cell select')) {
          e.target.classList.add("is-open");
        }
      });
      $("paymentRows").addEventListener("focusout", (e) => {
        if (e.target.matches('td:nth-child(4) select, .remittance-cell select')) {
          e.target.classList.remove("is-open");
        }
      });
      $("paymentRows").addEventListener("change", (e) => {
        if (e.target.matches('td:nth-child(4) select, .remittance-cell select')) {
          e.target.classList.remove("is-open");
        }
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
      $("copyPreviewHeaderButton").addEventListener("click", async () => {
        const company = state.draft && state.draft.companies[state.activeCompany];
        if (!company) return;
        const text = formatWhatsAppPeriodHeader(company).join("\n");
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("A cópia automática não está disponível neste navegador.");
        await navigator.clipboard.writeText(text);
        notify("Cabeçalho do levantamento copiado!");
      });
      $("copyPreviewCompanyButton").addEventListener("click", async () => {
        const company = state.draft && state.draft.companies[state.activeCompany];
        if (!company) return;
        // Copia apenas os dados da empresa (corpo), sem o cabeçalho do período
        const text = formatCompanyWhatsApp(company, state.activeCompany).join("\n");
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("A cópia automática não está disponível neste navegador.");
        await navigator.clipboard.writeText(text);
        notify(`Dados da empresa ${company.name} copiados!`);
      });
      $("copyPreviewObservationButton").addEventListener("click", async () => {
        const company = state.draft && state.draft.companies[state.activeCompany];
        if (!company) return;
        const text = calculateCompanyObservation(company);
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("A cópia automática não está disponível neste navegador.");
        await navigator.clipboard.writeText(text);
        notify(`Observação do saldo da empresa ${company.name} copiada!`);
      });
      $("whatsappButton").addEventListener("click", () => {
        try { openWhatsApp(); } catch (error) { showError(error); }
      });
      $("downloadReportButton").addEventListener("click", () => {
        try { downloadWhatsApp(); } catch (error) { showError(error); }
      });
      $("exportCsvButton").addEventListener("click", exportToCSV);
      $("printPdfButton").addEventListener("click", openPdfDialog);
      $("closePdfDialogButton").addEventListener("click", () => $("pdfDialog").close());
      $("selectAllPdfCompaniesButton").addEventListener("click", () => {
        $("pdfCompanyOptions").querySelectorAll("input").forEach((input) => { input.checked = true; });
      });
      $("confirmPdfButton").addEventListener("click", () => {
        try { printSelectedCompanies(); } catch (error) { showError(error); }
      });

      $("saveCompanyNamesBtn").addEventListener("click", () => saveCompanyNames().catch(showError));
      $("addCompanyBtn").addEventListener("click", addCompany);
      $("resetCompanyNamesBtn").addEventListener("click", () => resetCompanyNames().catch(showError));

      document.addEventListener("click", (event) => {
        const btn = event.target.closest(".password-toggle");
        if (!btn) return;
        const input = document.getElementById(btn.dataset.target);
        if (!input) return;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.textContent = show ? "🙈" : "👁";
        btn.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
        btn.setAttribute("title", show ? "Ocultar senha" : "Mostrar senha");
      });
      const addStatusBtn = $("addStatusBtn"); if (addStatusBtn) addStatusBtn.addEventListener("click", addStatusConfig);
      const addRemittanceBtn = $("addRemittanceBtn"); if (addRemittanceBtn) addRemittanceBtn.addEventListener("click", addRemittanceConfig);
      const saveAppConfigBtn = $("saveAppConfigBtn"); if (saveAppConfigBtn) saveAppConfigBtn.addEventListener("click", () => saveAppConfig().catch(showError));
      const resetAppConfigBtn = $("resetAppConfigBtn"); if (resetAppConfigBtn) resetAppConfigBtn.addEventListener("click", () => resetAppConfig().catch(showError));

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

      setupPreviewTextSelection();

      initialize();
    })();
  
