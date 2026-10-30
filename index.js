const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');
const pino = require('pino');

const supabaseUrl = 'https://lvdhbzjksspozeionbyg.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ID do Grupo Permitido (fallback de segurança)
const GRUPO_PERMITIDO_ID = "120363431552165371@g.us";

const sessoesAdmin = {};
const sessoesTb = {};

// Lista de todas as tabelas de fila (Índice 0 é a Mãe)
const TABELAS_FILA = [
    'fila_macrodroid',
    'fila_macrodroid_1',
    'fila_macrodroid_2',
    'fila_macrodroid_3',
    'fila_macrodroid_4',
    'fila_macrodroid_5',
    'fila_macrodroid_6',
    'fila_macrodroid_7',
    'fila_macrodroid_8',
    'fila_macrodroid_9'
];

let indiceUltimaFila = 0;

// Memória local para garantir sincronização imediata dos estados das filas
const memoriaFilas = {
    'fila_macrodroid': true,
    'fila_macrodroid_1': false,
    'fila_macrodroid_2': false,
    'fila_macrodroid_3': false,
    'fila_macrodroid_4': false,
    'fila_macrodroid_5': false,
    'fila_macrodroid_6': false,
    'fila_macrodroid_7': false,
    'fila_macrodroid_8': false,
    'fila_macrodroid_9': false
};

// Carrega a configuração do Supabase no arranque
async function carregarConfigFilas() {
    try {
        const { data } = await supabase.from('config_filas').select('*');
        if (data && data.length > 0) {
            data.forEach(item => {
                if (item.nome_tabela in memoriaFilas) {
                    memoriaFilas[item.nome_tabela] = !!item.ativa;
                }
            });
        }
    } catch (e) {
        console.log("Erro ao carregar estados iniciais das filas:", e);
    }
}

// Função auxiliar para obter a próxima tabela ativa em Round-Robin (começando sempre pela mãe)
async function obterProximaTabelaFila() {
    let indicesAtivos = [];
    TABELAS_FILA.forEach((tabela, idx) => {
        if (memoriaFilas[tabela] === true) {
            indicesAtivos.push(idx);
        }
    });

    if (indicesAtivos.length === 0) {
        return 'fila_macrodroid';
    }

    let proximoIndiceValido = indicesAtivos.find(idx => idx > indiceUltimaFila);
    
    if (proximoIndiceValido === undefined) {
        proximoIndiceValido = indicesAtivos[0];
    }

    indiceUltimaFila = proximoIndiceValido;
    return TABELAS_FILA[proximoIndiceValido];
}

// Função para inserir na fila correta de acordo com a regra circular
async function inserirNaFilaAtiva(dadosPedido) {
    const tabelaDestino = await obterProximaTabelaFila();
    const { error } = await supabase.from(tabelaDestino).insert([dadosPedido]);
    if (error) {
        console.log(`Erro ao inserir na tabela ${tabelaDestino}:`, error);
    } else {
        console.log(`Pedido direcionado com sucesso para a tabela: ${tabelaDestino}`);
    }
    return tabelaDestino;
}

// Função auxiliar para converter o nome da tabela no formato de Dispositivo amigável
function formatarNomeDispositivo(nomeTabela) {
    if (!nomeTabela) return "Dispositivo 1";
    if (nomeTabela === 'fila_macrodroid') return "Dispositivo 1";
    if (nomeTabela.startsWith('fila_macrodroid_')) {
        const num = nomeTabela.split('_').pop();
        return `Dispositivo ${parseInt(num) + 1}`;
    }
    return "Dispositivo 1";
}

// ==========================================
// FUNÇÃO CENTRALIZADA DE PROCESSAMENTO DE PACOTE
// ==========================================
async function identificarEProcessarPacote(valorPagamento, pacoteInput) {
    let dadosEncontrados = null;
    let tipoOferta = 'normal';

    if (valorPagamento) {
        const { data: dDiamante } = await supabase.from('diamantes').select('*').eq('valor', valorPagamento).maybeSingle();
        if (dDiamante) dadosEncontrados = dDiamante;
    }
    if (!dadosEncontrados && pacoteInput) {
        const { data: dDiamante } = await supabase.from('diamantes').select('*').ilike('megas', `%${pacoteInput}%`).maybeSingle();
        if (dDiamante) dadosEncontrados = dDiamante;
    }
    if (dadosEncontrados) tipoOferta = 'diamante';

    if (!dadosEncontrados && valorPagamento) {
        const { data: dMensal } = await supabase.from('mensais').select('*').eq('valor', valorPagamento).maybeSingle();
        if (dMensal) dadosEncontrados = dMensal;
    }
    if (!dadosEncontrados && pacoteInput) {
        const { data: dMensal } = await supabase.from('mensais').select('*').ilike('megas', `%${pacoteInput}%`).maybeSingle();
        if (dMensal) dadosEncontrados = dMensal;
    }
    if (dadosEncontrados && tipoOferta === 'normal') tipoOferta = 'mensal';

    if (!dadosEncontrados && valorPagamento) {
        const { data: dSemanal } = await supabase.from('semanais').select('*').eq('valor', valorPagamento).maybeSingle();
        if (dSemanal) dadosEncontrados = dSemanal;
    }
    if (!dadosEncontrados && pacoteInput) {
        const { data: dSemanal } = await supabase.from('semanais').select('*').ilike('megas', `%${pacoteInput}%`).maybeSingle();
        if (dSemanal) dadosEncontrados = dSemanal;
    }
    if (dadosEncontrados && tipoOferta === 'normal') tipoOferta = 'semanal';

    if (!dadosEncontrados) {
        if (valorPagamento) {
            const { data: dPreco } = await supabase.from('tabela_precos').select('*').eq('valor', valorPagamento).maybeSingle();
            if (dPreco) dadosEncontrados = dPreco;
        }
        if (!dadosEncontrados && pacoteInput) {
            const { data: dPreco } = await supabase.from('tabela_precos').select('*').ilike('megas', `%${pacoteInput}%`).maybeSingle();
            if (dPreco) dadosEncontrados = dPreco;
        }
        if (dadosEncontrados) tipoOferta = 'normal';
    }

    const nomePacoteFinal = dadosEncontrados?.megas || pacoteInput || 'N/A';
    const valorFinal = dadosEncontrados?.valor || valorPagamento || 0;

    if (!tipoOferta || tipoOferta === 'normal') {
        const pLower = nomePacoteFinal.toLowerCase();
        if (pLower.includes('diamante')) tipoOferta = 'diamante';
        else if (pLower.includes('mensal') || pLower.includes('30 dias')) tipoOferta = 'mensal';
        else if (pLower.includes('semanal') || pLower.includes('7 dias')) tipoOferta = 'semanal';
    }

    return {
        megas: nomePacoteFinal,
        valor: valorFinal,
        tipo: tipoOferta
    };
}

async function startBot() {
    await carregarConfigFilas();
    
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({ 
        logger: pino({ level: 'silent' }), 
        auth: state,
        browser: ['Ubuntu', 'Chrome', '122.0.6261.111'],
        emitOwnEvents: true,
        markOnlineOnConnect: true
    });

    if (!sock.authState.creds.registered) {
        const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
        const phoneNumber = await new Promise((resolve) => {
            readline.question('Digite seu número com ddi (ex: 25884xxxxxxx): ', resolve);
        });
        readline.close();

        try {
            const code = await sock.requestPairingCode(phoneNumber.trim());
            console.log(`\n================================`);
            console.log(`CÓDIGO DE PAREAMENTO: ${code}`);
            console.log(`================================\n`);
        } catch (err) {
            console.error("Erro ao solicitar código de pareamento:", err);
        }
    }

    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log("🤖 ROBÔ LIGADO COM SUCESSO ✅");
        }
    });

    iniciarMonitorMacrodroid(sock);

    const membrosCumprimentados = new Set();
    async function enviarBoasVindas(grupoId, membroInput) {
        let jidFinal = "";

        if (typeof membroInput === 'object' && membroInput !== null) {
            jidFinal = membroInput.phoneNumber || membroInput.id || "";
        } else if (typeof membroInput === 'string') {
            jidFinal = membroInput;
        }

        if (!jidFinal) return;

        if (!jidFinal.includes('@')) {
            jidFinal = `${jidFinal}@s.whatsapp.net`;
        }

        if (membrosCumprimentados.has(jidFinal)) return;
        membrosCumprimentados.add(jidFinal);
        
        setTimeout(() => membrosCumprimentados.delete(jidFinal), 60000);

        const numeroApenas = jidFinal.split('@')[0];
        const usuarioTag = `@${numeroApenas}`;

        const msgBoasVindas = `👋 *𝙱𝙴𝙼-𝚅𝙸𝙽𝙳𝙾(𝙰)* 👋\n\n` +
            `*🎉 Bem-vindo(a) ${usuarioTag},\n` +
            `Você entrou no grupo -{⚡Vendas de Megas⚡}\n` +
            `*📦 Para ver os pacotes* disponíveis: \n` +
            `\`👉 Tabela\` ou  \`Preços\`\n\n` +
            `*👉 Para Diamante:* \`ilimitado\`\n\n` +
            `🏧 *Para ver as formas de pagamento:*\n` +
            `👉 \`Pagamento\`\n\n` +
            `*💬 Dúvidas? Fale com o ADM do grupo.*\n\n` +
            `_☎️+258 85 867 4827\n\n` +
            `*⚡ Ofertas rápidas, seguras e sem complicações*`;

        await sock.sendMessage(grupoId, {
            text: msgBoasVindas,
            mentions: [jidFinal]
        });
    }

    sock.ev.on('group-participants.update', async (num) => {
        try {
            if (num.id === GRUPO_PERMITIDO_ID && num.action === 'add') {
                for (let novoMembro of num.participants) {
                    await enviarBoasVindas(num.id, novoMembro);
                }
            }
        } catch (err) {
            console.log("Erro no evento group-participants.update:", err);
        }
    });

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        const mek = chatUpdate.messages[0];
        if (!mek.message) return;

        const sender = mek.key.remoteJid;
        const participante = mek.key.participant || sender; 
        const isGroup = sender.endsWith('@g.us');

        if (isGroup && sender === GRUPO_PERMITIDO_ID) {
            const isStubAdd = mek.messageStubType === 27 || mek.messageStubType === 28 || mek.messageStubType === 32;
            if (isStubAdd && mek.messageStubParameters && mek.messageStubParameters.length > 0) {
                for (let novoMembro of mek.messageStubParameters) {
                    await enviarBoasVindas(sender, novoMembro);
                }
            }
        }

        if (mek.key.fromMe) return;

        const usuarioTag = `@${participante.split('@')[0]}`;
        const text = (mek.message.conversation || mek.message.extendedTextMessage?.text || mek.message.imageMessage?.caption || mek.message.documentMessage?.caption || "").trim();

        const sendMention = async (mensagem) => {
            await sock.sendMessage(sender, { 
                text: `${mensagem}\n\n${usuarioTag}`, 
                mentions: [participante],
                contextInfo: { mentionedJid: [participante] }
            });
        };

        if (!isGroup) {
            await sendMention(
                `*CARO CLIENTE*\n\n` +
                `Eu sou apenas um robô que não consigo falar directamente.\n` +
                `Peço desculpa 🙏\n` +
                `Falem com ADM Oficial\n` +
                `Número: 258 85 867 4827`
            );
            return;
        }

        if (isGroup && sender !== GRUPO_PERMITIDO_ID) {
            return;
        }

        async function verificarAdmin(userJid) {
            if (!isGroup) return true;
            try {
                const metadata = await sock.groupMetadata(sender);
                const participant = metadata.participants.find(p => p.id === userJid);
                return participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            } catch (err) {
                console.log("Erro ao verificar admin:", err);
                return false;
            }
        }

        if (sessoesAdmin[participante]) {
            const sessao = sessoesAdmin[participante];

            if (text.trim() === '.addfm') {
                let relatorio = `📊 **RELATÓRIO DA SESSÃO (.addfm)**\n\n`;
                relatorio += `👤 **Admin:** ${usuarioTag}\n`;
                relatorio += `🕒 **Total de alterações:** ${sessao.acoesRealizadas.length}\n\n`;

                if (sessao.acoesRealizadas.length === 0) {
                    relatorio += `Nenhuma alteração efetuada.\n`;
                } else {
                    sessao.acoesRealizadas.forEach((ac, index) => {
                        if (ac.tipo === 'adicao') {
                            relatorio += `${index + 1}. ➕ **Adicionado:** \`${ac.comando}\`\n   Resp: ${ac.resposta}\n`;
                        } else if (ac.tipo === 'exclusao') {
                            relatorio += `${index + 1}. 🗑️ **Excluído:** \`${ac.comando}\`\n`;
                        }
                    });
                }

                await sock.sendMessage(sender, { text: relatorio, mentions: [participante] }, { quoted: mek });
                delete sessoesAdmin[participante];
                return;
            }

            if (sessao.step === 'escolher_acao') {
                if (text === '1') {
                    sessao.step = 'aguardando_comando_add';
                    await sock.sendMessage(sender, { text: '✏️ Digite o nome do comando que deseja **adicionar** (exemplo: `.pix` ou `regras`):', quoted: mek });
                    return;
                } else if (text === '2') {
                    sessao.step = 'aguardando_comando_del';
                    await sock.sendMessage(sender, { text: '🗑️ Digite o nome do comando que deseja **excluir** (exemplo: `.pix` ou `Era 205`):', quoted: mek });
                    return;
                } else {
                    await sock.sendMessage(sender, { text: '⚠️ Opção inválida. Responda apenas com **1** (Adicionar), **2** (Excluir) ou **.addfm** para sair.' }, { quoted: mek });
                    return;
                }
            }

            if (sessao.step === 'aguardando_comando_add') {
                sessao.comandoTemp = text.toLowerCase().trim();
                sessao.step = 'aguardando_resposta_add';
                await sock.sendMessage(sender, { text: `📝 Agora digite a **resposta** que o comando \`${sessao.comandoTemp}\` deve enviar:` }, { quoted: mek });
                return;
            }

            if (sessao.step === 'aguardando_resposta_add') {
                const comando = sessao.comandoTemp;
                const resposta = text;

                await supabase.from('comandos_customizados').upsert([{ comando, resposta }]);

                sessao.acoesRealizadas.push({ tipo: 'adicao', comando, resposta });
                delete sessao.comandoTemp;
                sessao.step = 'escolher_acao';

                await sock.sendMessage(sender, { 
                    text: `✅ Comando \`${comando}\` adicionado com sucesso!\n\nDeseja realizar mais alguma ação?\n1️⃣ Adicionar outro comando\n2️⃣ Excluir um comando\n\n*(Ou digite \`.addfm\` para finalizar e ver o relatório)*` 
                }, { quoted: mek });
                return;
            }

            if (sessao.step === 'aguardando_comando_del') {
                const comandoDel = text.toLowerCase().trim();

                await supabase.from('comandos_customizados').delete().eq('comando', comandoDel);

                sessao.acoesRealizadas.push({ tipo: 'exclusao', comando: comandoDel });
                sessao.step = 'escolher_acao';

                await sock.sendMessage(sender, { 
                    text: `🗑️ Comando \`${comandoDel}\` excluído com sucesso!\n\nDeseja realizar mais alguma ação?\n1️⃣ Adicionar outro comando\n2️⃣ Excluir outro comando\n\n*(Ou digite \`.addfm\` para finalizar e ver o relatório)*` 
                }, { quoted: mek });
                return;
            }
        }

        if (sessoesTb[participante]) {
            const stb = sessoesTb[participante];

            if (stb.step === 'escolher_tabela') {
                const op = parseInt(text);
                const tabelas = ['tabela_precos', 'semanais', 'mensais', 'diamantes', 'comandos_customizados', 'transecoes_pendentes', 'fila_macrodroid', 'memoria_aguardando', 'pagamentos'];
                
                if (isNaN(op) || op < 1 || op > tabelas.length) {
                    await sock.sendMessage(sender, { text: `⚠️ Opção inválida. Responda com um número de 1 a ${tabelas.length}.` }, { quoted: mek });
                    return;
                }

                stb.tabelaSelecionada = tabelas[op - 1];
                stb.step = 'informar_coluna1';
                await sock.sendMessage(sender, { text: `📊 Tabela selecionada: *${stb.tabelaSelecionada}*\n\nDigite o nome da **primeira coluna** e o **valor** no formato:\n\`coluna=valor\`\n\nExemplo: \`megas=700MB\` ou \`valor=15\`` }, { quoted: mek });
                return;
            }

            if (stb.step === 'informar_coluna1') {
                if (!text.includes('=')) {
                    await sock.sendMessage(sender, { text: '⚠️ Formato inválido! Use o formato `coluna=valor`.' }, { quoted: mek });
                    return;
                }

                const [col1, ...val1Parts] = text.split('=');
                stb.col1 = col1.trim();
                stb.val1 = val1Parts.join('=').trim();

                stb.step = 'deseja_coluna2';
                await sock.sendMessage(sender, { text: `✅ Primeira coluna informada:\n*${stb.col1}*: \`${stb.val1}\`\n\nDeseja adicionar mais uma coluna nesta mesma linha?\n1️⃣ Sim\n2️⃣ Não (Salvar agora)` }, { quoted: mek });
                return;
            }

            if (stb.step === 'deseja_coluna2') {
                if (text === '1') {
                    stb.step = 'informar_coluna2';
                    await sock.sendMessage(sender, { text: `Digite o nome da **segunda coluna** e o **valor** no formato:\n\`coluna=valor\`\n\nExemplo: \`valor=15\`` }, { quoted: mek });
                    return;
                } else if (text === '2') {
                    const payload = {};
                    payload[stb.col1] = stb.val1;

                    const { error } = await supabase.from(stb.tabelaSelecionada).insert([payload]);

                    if (error) {
                        await sock.sendMessage(sender, { text: `❌ Erro ao inserir na tabela: ${error.message}` }, { quoted: mek });
                    } else {
                        await sock.sendMessage(sender, { text: `✅ Dados inseridos com sucesso na tabela *${stb.tabelaSelecionada}*!` }, { quoted: mek });
                    }
                    delete sessoesTb[participante];
                    return;
                } else {
                    await sock.sendMessage(sender, { text: '⚠️ Opção inválida. Digite 1 para Sim ou 2 para Não.' }, { quoted: mek });
                    return;
                }
            }

            if (stb.step === 'informar_coluna2') {
                if (!text.includes('=')) {
                    await sock.sendMessage(sender, { text: '⚠️ Formato inválido! Use o formato `coluna=valor`.' }, { quoted: mek });
                    return;
                }

                const [col2, ...val2Parts] = text.split('=');
                stb.col2 = col2.trim();
                stb.val2 = val2Parts.join('=').trim();

                const payload = {};
                payload[stb.col1] = stb.val1;
                payload[stb.col2] = stb.val2;

                const { error } = await supabase.from(stb.tabelaSelecionada).insert([payload]);

                if (error) {
                    await sock.sendMessage(sender, { text: `❌ Erro ao inserir na tabela: ${error.message}` }, { quoted: mek });
                } else {
                    await sock.sendMessage(sender, { text: `✅ Registro adicionado com sucesso na tabela *${stb.tabelaSelecionada}*!` }, { quoted: mek });
                }

                delete sessoesTb[participante];
                return;
            }
        }

        if (isGroup) {
            const isAdmin = await verificarAdmin(participante);

            if (!isAdmin) {
                const contextInfo = mek.message.extendedTextMessage?.contextInfo || {};
                const mentions = contextInfo.mentionedJid || [];
                
                const mencionaGrupo = mentions.includes(sender) || 
                                     contextInfo.isGroupJidMentioned === true ||
                                     text.includes('Este grupo foi mencionado') ||
                                     text.includes('@g.us');

                if (mencionaGrupo) {
                    try {
                        await sock.sendMessage(sender, { delete: mek.key });
                        await sock.groupParticipantsUpdate(sender, [participante], "remove");
                        await sock.sendMessage(sender, { 
                            text: `❌ ${usuarioTag} foi removido(a) automaticamente por causa de mencionar o grupo!`,
                            mentions: [participante]
                        });
                    } catch (err) {
                        console.log("Erro ao aplicar moderação de menção ao grupo:", err);
                    }
                    return;
                }

                const regexLink = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9][-a-zA-Z0-90-9]+\.(com|net|org|edu|gov|mil|br|pt|mz|info|io|me|tk|ml|ga|cf|gq)\b)/i;

                if (regexLink.test(text)) {
                    try {
                        await sock.sendMessage(sender, { delete: mek.key });
                        await sock.groupParticipantsUpdate(sender, [participante], "remove");
                        await sock.sendMessage(sender, { 
                            text: `❌ ${usuarioTag} foi removido(a) automaticamente por causa de mandar link e é proibido!`,
                            mentions: [participante]
                        });
                    } catch (err) {
                        console.log("Erro ao aplicar moderação de link:", err);
                    }
                    return;
                }
            }
        }

        if (text.startsWith('.')) {
            if (!isGroup) {
                await sock.sendMessage(sender, { text: '❌ Este comando só pode ser usado dentro de grupos.' }, { quoted: mek });
                return;
            }

            const isAdminGeral = await verificarAdmin(participante);
            if (!isAdminGeral) {
                await sock.sendMessage(sender, { text: '❌ Não tens permissão para usar este comando.' }, { quoted: mek });
                return;
            }

            const comandoInput = text.trim().toLowerCase();

            if (comandoInput.startsWith('.ativafila') || comandoInput.startsWith('.desativafila') || comandoInput.startsWith('.onfila')) {
                const matchNum = comandoInput.match(/\d+/);
                if (!matchNum) {
                    await sock.sendMessage(sender, { text: '⚠️ Especifica o número da fila (ex: `.ativafila1`, `.desativafila1`, `.onfila1`).', quoted: mek });
                    return;
                }
                const numFila = matchNum[0];
                const nomeTabelaAlvo = `fila_macrodroid_${numFila}`;

                if (comandoInput.startsWith('.ativafila')) {
                    memoriaFilas[nomeTabelaAlvo] = true;
                    await supabase.from('config_filas').upsert([{ nome_tabela: nomeTabelaAlvo, ativa: true }]);
                    await sock.sendMessage(sender, { text: `✅ Fila ${numFila} (*${nomeTabelaAlvo}*) ATIVADA com sucesso!` }, { quoted: mek });
                    return;
                }

                if (comandoInput.startsWith('.desativafila')) {
                    memoriaFilas[nomeTabelaAlvo] = false;
                    await supabase.from('config_filas').upsert([{ nome_tabela: nomeTabelaAlvo, ativa: false }]);
                    await sock.sendMessage(sender, { text: `🔴 Fila ${numFila} (*${nomeTabelaAlvo}*) DESATIVADA com sucesso!` }, { quoted: mek });
                    return;
                }

                if (comandoInput.startsWith('.onfila')) {
                    const statusAtual = memoriaFilas[nomeTabelaAlvo] === true;
                    
                    let totalPendentes = 0;
                    try {
                        const { count } = await supabase.from(nomeTabelaAlvo).select('*', { count: 'exact', head: true }).eq('status', 'pendente');
                        totalPendentes = count || 0;
                    } catch (e) {
                        totalPendentes = 0;
                    }

                    await sock.sendMessage(sender, { 
                        text: `📊 **STATUS DA FILA ${numFila}**\n\n📌 Tabela: \`${nomeTabelaAlvo}\`\n⚡ Estado: ${statusAtual ? '🟢 ATIVA' : '🔴 DESATIVA'}\n📦 Pedidos pendentes: ${totalPendentes}`, 
                        quoted: mek 
                    });
                    return;
                }
            }

            const comandoInputOriginal = text.trim();

            if (comandoInputOriginal === '.confirmar' || comandoInputOriginal.startsWith('.confirmar ')) {
                const contextInfo = mek.message.extendedTextMessage?.contextInfo;
                const quotedMsg = contextInfo?.quotedMessage;
                const clienteSender = contextInfo?.participant;

                if (!quotedMsg) {
                    await sendMention(`⚠️ *Responda/cite a mensagem do comprovativo* usando o comando \`.confirmar\` para validar.`);
                    return;
                }

                const textoCitado = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || "";

                if (!textoCitado.includes("Confirmado") && !textoCitado.includes("ID da transacao")) {
                    await sendMention(`❌ *A mensagem citada não contém um comprovativo válido!*`);
                    return;
                }

                let refConfirmada = textoCitado.match(/(Confirmado|ID da transacao)[:\s]+([A-Z0-9.]+)/i)?.[2] || "N/A";
                refConfirmada = refConfirmada.replace(/\.$/, "").trim();

                let valorConfirmado = 0;
                const matchValor = textoCitado.match(/(\d+(\.\d+)?)\s*MT/i);
                if (matchValor) {
                    valorConfirmado = parseFloat(matchValor[1]);
                }

                let numeroVodacom = null;
                const linhas = textoCitado.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
                
                if (linhas.length > 1) {
                    const ultimaLinha = linhas[linhas.length - 1].replace(/\D/g, '');
                    if (ultimaLinha.length === 9 && (ultimaLinha.startsWith('84') || ultimaLinha.startsWith('85'))) {
                        numeroVodacom = ultimaLinha;
                    }
                }

                const { data: jaUsado } = await supabase
                    .from('memoria_aguardando')
                    .select('*')
                    .eq('referencia', refConfirmada)
                    .maybeSingle();

                if (jaUsado) {
                    await sendMention(`❌ *Este comprovativo (${refConfirmada}) já foi processado anteriormente!*`);
                    return;
                }

                const { data: txExistente } = await supabase
                    .from('transecoes_pendentes')
                    .select('*')
                    .eq('referencia', refConfirmada)
                    .maybeSingle();

                if (!txExistente) {
                    await supabase.from('transecoes_pendentes').insert([{
                        referencia: refConfirmada,
                        valor: valorConfirmado,
                        status: numeroVodacom ? 'processado' : 'em_uso'
                    }]);
                } else {
                    await supabase.from('transecoes_pendentes').update({ status: numeroVodacom ? 'processado' : 'em_uso' }).eq('id', txExistente.id);
                }

                const clienteAlvo = clienteSender || participante;

                if (numeroVodacom) {
                    await supabase.from('memoria_aguardando').insert([{ 
                        sender: clienteAlvo, 
                        valor: valorConfirmado, 
                        referencia: refConfirmada, 
                        status: 'usado',
                        usado_por: `@${clienteAlvo.split('@')[0]}`,
                        data_uso: new Date().toISOString()
                    }]);

                    const pacoteIdentificado = await identificarEProcessarPacote(valorConfirmado, null);

                    if (pacoteIdentificado.tipo !== 'normal') {
                        let tituloMsg = "📦 *PACOTE PROCESSADO*";
                        if (pacoteIdentificado.tipo === 'diamante') tituloMsg = "💎 *PACOTE DIAMANTE PROCESSADO*";
                        else if (pacoteIdentificado.tipo === 'mensal') tituloMsg = "📅 *PACOTE MENSAL PROCESSADO*";
                        else if (pacoteIdentificado.tipo === 'semanal') tituloMsg = "📆 *PACOTE SEMANAL PROCESSADO*";
                        
                        const msgManual = `${tituloMsg}\n\n✅ Seu pacote foi enviado para processamento!\n\n📱 Número: ${numeroVodacom}\n📦 Pacote: ${pacoteIdentificado.megas}\n🦄 Referência: ${refConfirmada}\n\n⏰ Aguarde a ativação em instantes!\n\nNB. Ativação dessa oferta é manualmente pelo admin do grupo.`;

                        await sock.sendMessage(sender, { text: `${msgManual}\n\n@${clienteAlvo.split('@')[0]}`, mentions: [clienteAlvo] });
                        return;
                    }

                    await inserirNaFilaAtiva({
                        telefone: numeroVodacom,
                        pacote: pacoteIdentificado.megas,
                        status: 'pendente',
                        sender: clienteAlvo,
                        referencia: refConfirmada,
                        grupo_id: sender // <--- GUARDAR O ID DO GRUPO EXATO
                    });

                    const msg = `✅ *Comprovativo Aprovado Manualmente pelo Admin!*\n\n💰 *Referência:* ${refConfirmada}\n📊 *Megas:* ${pacoteIdentificado.megas}\n📱 *Número:* ${numeroVodacom}\n\n_⏳ Processando... Aguarde enquanto o Sistema executa a transferência_`;
                    await sendMention(msg);
                    return;
                }

                await supabase.from('memoria_aguardando').insert([{ 
                    sender: clienteAlvo, 
                    valor: valorConfirmado, 
                    referencia: refConfirmada, 
                    status: 'pendente' 
                }]);

                const clienteTag = `@${clienteAlvo.split('@')[0]}`;
                await sock.sendMessage(sender, {
                    text: `✅ *Comprovativo Aprovado Manualmente pelo Admin!*\n\n💰 *Referência:* ${refConfirmada}\n👤 *Cliente:* ${clienteTag}\n\nEnvie o número Vodacom agora para concluir.`,
                    mentions: [clienteAlvo]
                });
                return;
            }

            if (comandoInput.startsWith('.ban')) {
                let alvoBan = mek.message.extendedTextMessage?.contextInfo?.participant;
                
                if (!alvoBan) {
                    const mentions = mek.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    if (mentions.length > 0) {
                        alvoBan = mentions[0];
                    }
                }

                if (!alvoBan) {
                    await sock.sendMessage(sender, { text: '⚠️ Responda à mensagem da pessoa ou mencione-a junto com `.ban` para removê-la.', quoted: mek });
                    return;
                }

                try {
                    await sock.groupParticipantsUpdate(sender, [alvoBan], "remove");
                    await sock.sendMessage(sender, { 
                        text: `🔨 O membro @${alvoBan.split('@')[0]} foi banido(a) do grupo por ordem de um administrador.`,
                        mentions: [alvoBan]
                    });
                } catch (err) {
                    await sock.sendMessage(sender, { text: `❌ Erro ao tentar banir o membro. Verifique se o bot possui privilégios de administrador.` }, { quoted: mek });
                }
                return;
            }

            if (comandoInput === '.grupo f') {
                try {
                    await sock.groupSettingUpdate(sender, 'announcement');
                    await sock.sendMessage(sender, { text: '🤖 GRUPO FECHADO🔒' }, { quoted: mek });
                } catch (err) {
                    await sock.sendMessage(sender, { text: '❌ Erro ao tentar fechar o grupo. Certifique-se de que o bot é administrador.' }, { quoted: mek });
                }
                return;
            }

            if (comandoInput === '.grupo a') {
                try {
                    await sock.groupSettingUpdate(sender, 'not_announcement');
                    
                    const metadata = await sock.groupMetadata(sender);
                    const allParticipants = metadata.participants.map(p => p.id);

                    await sock.sendMessage(sender, { 
                        text: '🤖 GRUPO ABERTO 🔓',
                        mentions: allParticipants
                    });
                } catch (err) {
                    await sock.sendMessage(sender, { text: '❌ Erro ao tentar abrir o grupo. Certifique-se de que o bot é administrador.' }, { quoted: mek });
                }
                return;
            }

            if (comandoInput === '.addcmd') {
                sessoesAdmin[participante] = {
                    step: 'escolher_acao',
                    acoesRealizadas: []
                };

                await sock.sendMessage(sender, { 
                    text: '🛠️ **Gestão de Comandos**\n\nO que deseja fazer?\n1️⃣ Quero adicionar novo comando\n2️⃣ Quero excluir\n\n*(Responda com 1 ou 2)*' 
                }, { quoted: mek });
                return;
            }

            if (comandoInput === '.addfm') {
                const sessao = sessoesAdmin[participante];
                if (!sessao) {
                    await sock.sendMessage(sender, { text: '⚠️ Não tem nenhum processo ativo. Digite `.addcmd` primeiro.' }, { quoted: mek });
                    return;
                }

                let relatorio = `📊 **RELATÓRIO DA SESSÃO (.addfm)**\n\n`;
                relatorio += `👤 **Admin:** ${usuarioTag}\n`;
                relatorio += `🕒 **Total de alterações:** ${sessao.acoesRealizadas.length}\n\n`;

                if (sessao.acoesRealizadas.length === 0) {
                    relatorio += `Nenhuma alteração efetuada.\n`;
                } else {
                    sessao.acoesRealizadas.forEach((ac, index) => {
                        if (ac.tipo === 'adicao') {
                            relatorio += `${index + 1}. ➕ **Adicionado:** \`${ac.comando}\`\n   Resp: ${ac.resposta}\n`;
                        } else if (ac.tipo === 'exclusao') {
                            relatorio += `${index + 1}. 🗑️ **Excluído:** \`${ac.comando}\`\n`;
                        }
                    });
                }

                await sock.sendMessage(sender, { text: relatorio, mentions: [participante] }, { quoted: mek });
                delete sessoesAdmin[participante];
                return;
            }

            if (comandoInput === '.addtb') {
                sessoesTb[participante] = {
                    step: 'escolher_tabela'
                };

                const msgTabelas = `📋 **ADICIONAR DADOS NO SUPABASE (.addtb)**\n\nEscolha a tabela que deseja modificar:\n\n1️⃣ \`tabela_precos\`\n2️⃣ \`semanais\`\n3️⃣ \`mensais\`\n4️⃣ \`diamantes\`\n5️⃣ \`comandos_customizados\`\n6️⃣ \`transecoes_pendentes\`\n7️⃣ \`fila_macrodroid\`\n8️⃣ \`memoria_aguardando\`\n9️⃣ \`pagamentos\`\n\n*(Responda enviando o número da opção desejada)*`;

                await sock.sendMessage(sender, { text: msgTabelas }, { quoted: mek });
                return;
            }

            if (text.toLowerCase().startsWith('.comprar')) {
                const partes = text.trim().split(/\s+/);
                
                if (partes.length < 3) {
                    await sendMention(`❌ *Formato inválido!*\nUse: \`.comprar [pacote] [numero]\` ou \`.comprar [pacote] [numero] [referencia]\``);
                    return;
                }

                const pacoteSolicitado = partes[1].toLowerCase();
                const telefoneSolicitado = partes[2];
                
                if (!/^\d{9}$/.test(telefoneSolicitado) || !/^8[45]/.test(telefoneSolicitado)) {
                    await sendMention(`❌ *Número de telefone inválido!* Deve ter 9 dígitos e começar por 84 ou 85.`);
                    return;
                }

                let referenciaInformada = null;
                const refIndex = partes.findIndex(p => p.toLowerCase() === 'ref:' || p.toLowerCase() === 'ref');
                if (refIndex !== -1 && partes[refIndex + 1]) {
                    referenciaInformada = partes[refIndex + 1];
                } else if (partes.length >= 4 && !partes[3].toLowerCase().startsWith('ref')) {
                    referenciaInformada = partes[3];
                }

                let referenciaFinal = referenciaInformada;
                let transacaoReal = null;

                if (referenciaFinal) {
                    referenciaFinal = referenciaFinal.replace(/\.$/, "").trim();

                    const { data: txEncontrada } = await supabase
                        .from('transecoes_pendentes')
                        .select('*')
                        .eq('referencia', referenciaFinal)
                        .eq('status', 'pendente')
                        .maybeSingle();

                    transacaoReal = txEncontrada;

                    if (!transacaoReal) {
                        await sendMention(`❌ *Referência inválida ou já processada!* Verifique o código enviado.`);
                        return;
                    }
                } else {
                    referenciaFinal = 'ADM' + Date.now();
                }

                const pacoteIdentificado = await identificarEProcessarPacote(null, pacoteSolicitado);

                if (transacaoReal) {
                    await supabase.from('transecoes_pendentes').update({ status: 'processado' }).eq('id', transacaoReal.id);
                } else {
                    await supabase.from('transecoes_pendentes').insert([{
                        referencia: referenciaFinal,
                        valor: pacoteIdentificado.valor,
                        status: 'processado'
                    }]).select();
                }

                await supabase.from('memoria_aguardando').insert([{
                    sender: participante,
                    valor: pacoteIdentificado.valor,
                    referencia: referenciaFinal,
                    status: 'usado',
                    usado_por: usuarioTag,
                    data_uso: new Date().toISOString()
                }]);

                if (pacoteIdentificado.tipo !== 'normal') {
                    let tituloMsg = "📦 *PACOTE PROCESSADO*";
                    if (pacoteIdentificado.tipo === 'diamante') tituloMsg = "💎 *PACOTE DIAMANTE PROCESSADO*";
                    else if (pacoteIdentificado.tipo === 'mensal') tituloMsg = "📅 *PACOTE MENSAL PROCESSADO*";
                    else if (pacoteIdentificado.tipo === 'semanal') tituloMsg = "📆 *PACOTE SEMANAL PROCESSADO*";
                    
                    const msgManual = `${tituloMsg}\n\n✅ Seu pacote foi enviado para processamento!\n\n📱 Número: ${telefoneSolicitado}\n📦 Pacote: ${pacoteIdentificado.megas}\n🦄 Referência: ${referenciaFinal}\n\n⏰ Aguarde a ativação em instantes!\n\nNB. Ativação dessa oferta é manualmente pelo admin do grupo.`;

                    await sock.sendMessage(sender, { text: `${msgManual}\n\n${usuarioTag}`, mentions: [participante] });
                    return;
                }

                await inserirNaFilaAtiva({
                    telefone: telefoneSolicitado,
                    pacote: pacoteIdentificado.megas,
                    status: 'pendente',
                    sender: participante,
                    referencia: referenciaFinal,
                    grupo_id: sender // <--- GUARDAR O ID DO GRUPO EXATO
                });

                const dataHoraAtual = new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' });
                const msgSucessoComprar = `✅ *PEDIDO CRIADO COM SUCESSO!*\n\n💰 Referência: ${referenciaFinal}\n📊 Megas: ${pacoteIdentificado.megas}\n📱 Número: ${telefoneSolicitado}\n📍 Grupo: Vendas de Megas\n\n🔄 Pedido registrado e aguardando processamento.\n⏰ ${dataHoraAtual}`;

                await sendMention(msgSucessoComprar);
                return;
            }

            return;
        }

        const isImage = !!(
            mek.message.imageMessage || 
            mek.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage ||
            (mek.message.documentMessage?.mimetype && mek.message.documentMessage.mimetype.startsWith('image/'))
        );
                        
        const isAudio = !!(mek.message.audioMessage || mek.message.voiceMessage);

        if (isImage || isAudio) {
            if (isGroup) {
                const isAdminMidia = await verificarAdmin(participante);
                if (!isAdminMidia) {
                    try {
                        await sock.sendMessage(sender, { delete: mek.key });
                        
                        let mensagemAviso = isImage 
                            ? `❌ Processamento de imagens desactivado \n📄 Solicitamos que o comprovante seja enviado em formato de texto.\n\nℹ️ Esta medida foi adotada para garantir que o sistema funcione de forma mais rápida, estável e com menos falhas.`
                            : `❌ Processamento de áudios desactivado \n📄 Solicitamos que o comprovante seja enviado em formato de texto.\n\nℹ️ Esta medida foi adotada para garantir que o sistema funcione de forma mais rápida, estável e com menos falhas.`;

                        await sock.sendMessage(sender, { 
                            text: `${mensagemAviso}\n\n${usuarioTag}`,
                            mentions: [participante],
                            contextInfo: { mentionedJid: [participante] }
                        });
                    } catch (err) {
                        console.log("Erro ao apagar multimédia (imagem/áudio):", err);
                    }
                    return;
                }
            }
        }

        if (text.toLowerCase().includes('movitel')) {
            await sendMention(
                `🚨 *CARO CLIENTE* 🚨\n` +
                `❌ Não vendemos megas da Movitel.\n` +
                `✅ Trabalhamos apenas com Vodacom. 📱🔴\n` +
                `Obrigado pela compreensão! 🙏`
            );
            return;
        }

        if (text.includes("Confirmado") || text.includes("ID da transacao")) {
            let numDestino = null;
            if (text.includes("ID da transacao")) {
                const matchEmola = text.match(/para\s+conta\s+(\d+)/i);
                if (matchEmola) numDestino = matchEmola[1];
            } else if (text.includes("Confirmado")) {
                const matchMpesa = text.match(/para\s+(\d+)\s*-/i);
                if (matchMpesa) numDestino = matchMpesa[1];
            }

            if (numDestino) {
                const { data: pagamentoValido } = await supabase
                    .from('pagamentos')
                    .select('*')
                    .eq('numero', numDestino)
                    .maybeSingle();

                if (!pagamentoValido) {
                    await sock.sendMessage(sender, {
                        text: `❌ ${usuarioTag} *Comprovativo Rejeitado!*\n\n⚠️ O número de destino (\`${numDestino}\`) para o qual foi feita a transferência não pertence aos números oficiais autorizados deste grupo.\n\nVerifique os dados corretos de pagamento na tabela do grupo.`,
                        mentions: [participante]
                    });
                    return;
                }
            }

            let referencia = text.match(/(Confirmado|ID da transacao)[:\s]+([A-Z0-9.]+)/i)?.[2] || "N/A";
            referencia = referencia.replace(/\.$/, "").trim();

            let textoSemPara = text.replace(/para\s+(8[457]\d{7})/gi, 'REMOVIDO');
            let numerosEncontrados = textoSemPara.match(/\b(8[45]\s*\d{3}\s*\d{4}|8[45]\d{7})\b/g) || [];
            let numeroVodacom = null;

            if (numerosEncontrados.length > 0) {
                let ultimoNum = numerosEncontrados[numerosEncontrados.length - 1].replace(/\D/g, '');
                if (ultimoNum.startsWith('84') || ultimoNum.startsWith('85')) {
                    numeroVodacom = ultimoNum;
                }
            }

            const { data: jaUsado } = await supabase
                .from('memoria_aguardando')
                .select('*')
                .eq('referencia', referencia)
                .maybeSingle();
            
            if (jaUsado) {
                let jidInjetar = jaUsado.sender || participante;
                
                let numFormatadoTag = jidInjetar.split('@')[0].split(':')[0].replace(/\D/g, '');
                let tagFormatada = `@${numFormatadoTag}`;

                await sock.sendMessage(sender, {
                    text: `❌ ${usuarioTag} Comprovativo já utilizado!\n\n👤 Utilizado por: ${tagFormatada}\n📅 Data: ${new Date(jaUsado.data_uso || Date.now()).toLocaleString('pt-PT')}\n\nEste comprovativo não pode ser processado novamente.`,
                    mentions: [participante, jidInjetar]
                });
                return;
            }

            const { data: transacaoReal } = await supabase
                .from('transecoes_pendentes')
                .select('*')
                .eq('referencia', referencia)
                .eq('status', 'pendente')
                .maybeSingle();

            if (!transacaoReal) {
                await sendMention(`❌ *COMPROVATIVO INVÁLIDO OU NÃO ENCONTRADO!*\n\nVerifique se a referência está correta ou se já foi processada.`);
                return;
            }

            if (numeroVodacom) {
                await supabase.from('memoria_aguardando').insert([{ 
                    sender: participante, 
                    valor: transacaoReal.valor, 
                    referencia: referencia, 
                    status: 'usado',
                    usado_por: usuarioTag,
                    data_uso: new Date().toISOString()
                }]);
                
                await supabase.from('transecoes_pendentes').update({ status: 'processado' }).eq('id', transacaoReal.id);

                const pacoteIdentificado = await identificarEProcessarPacote(transacaoReal.valor, null);

                if (pacoteIdentificado.tipo !== 'normal') {
                    let tituloMsg = "📦 *PACOTE PROCESSADO*";
                    if (pacoteIdentificado.tipo === 'diamante') tituloMsg = "💎 *PACOTE DIAMANTE PROCESSADO*";
                    else if (pacoteIdentificado.tipo === 'mensal') tituloMsg = "📅 *PACOTE MENSAL PROCESSADO*";
                    else if (pacoteIdentificado.tipo === 'semanal') tituloMsg = "📆 *PACOTE SEMANAL PROCESSADO*";
                    
                    const msgManual = `${tituloMsg}\n\n✅ Seu pacote foi enviado para processamento!\n\n📱 Número: ${numeroVodacom}\n📦 Pacote: ${pacoteIdentificado.megas}\n🦄 Referência: ${referencia}\n\n⏰ Aguarde a ativação em instantes!\n\nNB. Ativação dessa oferta é manualmente pelo admin do grupo.`;

                    await sock.sendMessage(sender, { text: `${msgManual}\n\n${usuarioTag}`, mentions: [participante] });
                    return;
                }
                
                await inserirNaFilaAtiva({
                    telefone: numeroVodacom,
                    pacote: pacoteIdentificado.megas,
                    status: 'pendente',
                    sender: participante,
                    referencia: referencia,
                    grupo_id: sender // <--- GUARDAR O ID DO GRUPO EXATO
                });

                const msg = `✅ *Pedido Recebido!*\n\n💰 *Referência:* ${referencia}\n📊 *Megas:* ${pacoteIdentificado.megas}\n📱 *Número:* ${numeroVodacom}\n\n_⏳Processando... Aguarde enquanto o Sistema executa a transferência_`;
                await sendMention(msg);
                return;
            }

            await supabase.from('memoria_aguardando').insert([{ 
                sender: participante, 
                valor: transacaoReal.valor, 
                referencia: referencia, 
                status: 'pendente' 
            }]);
            
            await supabase.from('transecoes_pendentes').update({ status: 'em_uso' }).eq('id', transacaoReal.id);
            
            await sendMention(`✅ *Comprovativo approved!*\nEnvie o número Vodacom agora para concluir.`);
            return;
        }

        let numeroLimpoText = text.replace(/\D/g, '');
        
        if (numeroLimpoText.length >= 8 && numeroLimpoText.length <= 9) {
            const { data: mem } = await supabase
                .from('memoria_aguardando')
                .select('*')
                .eq('sender', participante)
                .eq('status', 'pendente')
                .order('id', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (!mem) {
                await sendMention(`*Envie comprovativo*`);
                return;
            }

            const isVodacom = numeroLimpoText.length === 9 && /^8[45]/.test(numeroLimpoText);

            if (!isVodacom) {
                await sendMention(
                    `❌ *Número Inválido!*\n` +
                    `Vendemos apenas Megas da Vodacom.\n` +
                    `Por favor, envie um número da Vodacom que comece por 84 ou 85 para receber os dados.`
                );
                return;
            }

            await supabase.from('memoria_aguardando').update({ 
                status: 'usado', 
                usado_por: usuarioTag, 
                data_uso: new Date().toISOString() 
            }).eq('id', mem.id);

            await supabase.from('transecoes_pendentes').update({ 
                status: 'processado' 
            }).eq('referencia', mem.referencia);

            const pacoteIdentificado = await identificarEProcessarPacote(mem.valor, null);

            if (pacoteIdentificado.tipo !== 'normal') {
                let tituloMsg = "📦 *PACOTE PROCESSADO*";
                if (pacoteIdentificado.tipo === 'diamante') tituloMsg = "💎 *PACOTE DIAMANTE PROCESSADO*";
                else if (pacoteIdentificado.tipo === 'mensal') tituloMsg = "📅 *PACOTE MENSAL PROCESSADO*";
                else if (pacoteIdentificado.tipo === 'semanal') tituloMsg = "📆 *PACOTE SEMANAL PROCESSADO*";
                
                const msgManual = `${tituloMsg}\n\n✅ Seu pacote foi enviado para processamento!\n\n📱 Número: ${numeroLimpoText}\n📦 Pacote: ${pacoteIdentificado.megas}\n🦄 Referência: ${mem.referencia}\n\n⏰ Aguarde a ativação em instantes!\n\nNB. Ativação dessa oferta é manualmente pelo admin do grupo.`;

                await sock.sendMessage(sender, { text: `${msgManual}\n\n${usuarioTag}`, mentions: [participante] });
                return;
            }
            
            await inserirNaFilaAtiva({
                telefone: numeroLimpoText,
                pacote: pacoteIdentificado.megas,
                status: 'pendente',
                sender: participante,
                referencia: mem.referencia,
                grupo_id: sender // <--- GUARDAR O ID DO GRUPO EXATO
            });

            const msg = `✅ *Pedido Recebido!*\n\n💰 *Referência:* ${mem.referencia}\n📊 *Megas:* ${pacoteIdentificado.megas}\n📱 *Número:* ${numeroLimpoText}\n\n_⏳Processando... Aguarde enquanto o Sistema executa a transferência_`;
            await sendMention(msg);
            return;
        }

        const cmd = text.toLowerCase().trim();

        const palavrasTabela = ['tabela', 'preço', 'precos', 'preco', 'valores', 'valor', 'quanto custa', 'pacotes'];
        if (palavrasTabela.some(p => cmd.includes(p))) {
            const { data: resTabela } = await supabase.from('comandos_customizados').select('resposta').eq('comando', 'tabela').maybeSingle();
            if (resTabela?.resposta) {
                await sendMention(resTabela.resposta);
                return;
            }
        }

        const palavrasPagamento = ['pagamento', 'pagar', 'como pagar', 'm-pesa', 'mpesa', 'e-mola', 'emola', 'conta', 'iban'];
        if (palavrasPagamento.some(p => cmd.includes(p))) {
            const { data: resPagamento } = await supabase.from('comandos_customizados').select('resposta').eq('comando', 'pagamento').maybeSingle();
            if (resPagamento?.resposta) {
                await sendMention(resPagamento.resposta);
                return;
            }
        }

        const palavrasComo = ['como', 'como comprar', 'como fazer para adquirir', 'adquirir', 'passos'];
        if (palavrasComo.some(p => cmd.includes(p))) {
            const { data: resComo } = await supabase.from('comandos_customizados').select('resposta').eq('comando', 'como').maybeSingle();
            if (resComo?.resposta) {
                await sendMention(resComo.resposta);
                return;
            }
        }

        const { data: resGeral } = await supabase.from('comandos_customizados').select('resposta').eq('comando', cmd).maybeSingle();
        if (resGeral?.resposta) {
            await sendMention(resGeral.resposta);
            return;
        }
    });
}

// ==========================================
// MONITOR DO MACRODROID DIRETO E INFALÍVEL
// ==========================================
function iniciarMonitorMacrodroid(sock) {
    setInterval(async () => {
        try {
            const { data: concluidosMacro, error: errMacro } = await supabase
                .from('historico_concluidos')
                .select('*');

            if (errMacro || !concluidosMacro || concluidosMacro.length === 0) return;

            for (let itemMacro of concluidosMacro) {
                let tabelaEncontrada = 'fila_macrodroid';
                if (itemMacro.referencia) {
                    let refLimpa = itemMacro.referencia.trim();
                    for (let tabela of TABELAS_FILA) {
                        const { data: updateRes } = await supabase
                            .from(tabela)
                            .update({ status: 'concluido' })
                            .ilike('referencia', `%${refLimpa}%`)
                            .select();

                        if (updateRes && updateRes.length > 0) {
                            tabelaEncontrada = tabela;
                            break;
                        }
                    }
                }

                let refTransacao = itemMacro.referencia || 'N/A';
                let telTransacao = itemMacro.telefone || 'N/A';
                let pacTransacao = itemMacro.pacote || 'N/A';
                let clienteSender = itemMacro.sender || null;

                if (!clienteSender && refTransacao !== 'N/A') {
                    const { data: dadosMemoria } = await supabase
                        .from('memoria_aguardando')
                        .select('sender')
                        .eq('referencia', refTransacao)
                        .maybeSingle();

                    if (dadosMemoria) {
                        clienteSender = dadosMemoria.sender;
                    }
                }

                // 🌟 RECUPERA O GRUPO ID DIRETAMENTE DO HISTORICO OU DA FILA
                let grupoJid = itemMacro.grupo_id || GRUPO_PERMITIDO_ID;

                if (!itemMacro.grupo_id && refTransacao !== 'N/A') {
                    for (let tabela of TABELAS_FILA) {
                        const { data: dadosFila } = await supabase
                            .from(tabela)
                            .select('grupo_id')
                            .ilike('referencia', `%${refTransacao}%`)
                            .maybeSingle();

                        if (dadosFila && dadosFila.grupo_id) {
                            grupoJid = dadosFila.grupo_id;
                            break;
                        }
                    }
                }

                const clienteTag = clienteSender ? `@${clienteSender.split('@')[0]}` : '@Cliente';
                const dataHoraAtual = new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' });
                const nomeDispositivoFinal = formatarNomeDispositivo(tabelaEncontrada);

                const mensagemSucesso = `✅ *Transação Concluída Com Sucesso*\n\n💰 *Referência:* ${refTransacao}\n📱 *Telefone:* ${telTransacao}\n📊 *Pacote:* ${pacTransacao}\n⏰ *Data/Hora:* ${dataHoraAtual}\n👤 *Cliente:* ${clienteTag}\n📱 *Finalizado:* ${nomeDispositivoFinal}\n\n_Transferencia Processada Automáticamente Pelo Sistema_`;

                let mentionsList = clienteSender ? [clienteSender] : [];

                // 3. Envia obrigatoriamente a mensagem de conclusão NO GRUPO EXATO DE ORIGEM
                await sock.sendMessage(grupoJid, { 
                    text: mensagemSucesso,
                    mentions: mentionsList
                });

                console.log(`Transação ${refTransacao} notificada com sucesso no grupo ${grupoJid}!`);

                // 4. Remove o item processado da tabela historico_concluidos
                await supabase
                    .from('historico_concluidos')
                    .delete()
                    .eq('id', itemMacro.id);
            }
        } catch (err) {
            console.log("Erro no monitor do MacroDroid:", err);
        }
    }, 4000);
}

startBot();

