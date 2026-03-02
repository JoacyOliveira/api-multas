import puppeteer from 'puppeteer';
import { Request, Response } from 'express';
import utils from '../utils/utils';
import validation from '../validations/validation';

class PB {

    // Endpoint principal
    index = async (req: Request, res: Response) => {
        const placa = req.body.placa as string;
        const renavam = req.body.renavam as string;

        const errors = validation.generic(placa, renavam);
        if (errors) return res.status(400).json(errors);

        try {
            const multas = await this.scrap(placa, renavam);
            res.status(200).json(multas);
        } catch (err: any) {
            console.error('Erro no scrap PB:', err);
            res.status(500).json({ error: 'Não foi possível consultar multas PB', message: err.message });
        }
    }

    // Função de scraping
    scrap = async (placa: string, renavam: string) => {
        const browser = await puppeteer.launch({
            headless: process.env.NODE_ENV === 'production' ? 'new' : false,
            slowMo: process.env.NODE_ENV === 'production' ? 0 : 50,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas'
            ],
            defaultViewport: null
        });

        let page;
        try {
            page = await browser.newPage();

            const tablesMultas = 'table[width="648"]';
            const tablesDados = 'table[width="650"]';
            const tablesPagamento = 'table[width="647"]';
            const errorSelect = 'table[width="644"] td[height="92"]';

            const url = `${process.env.PB_URL}/BBDT_MULTABOLETO_CLIENTE/MultaBoleto?placa=${placa}&renavam=${renavam}&opcao=I&display=web&redirect=ok`;
            console.log('Abrindo URL PB:', url);

            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

            // Verifica erros da página
            const errorRenavam = await page.$$eval(errorSelect, tds => tds.map(td => td.innerText));
            const errorClear = errorRenavam[1]?.replace(/(\r\n|\n|\r)/gm, "") || '';
            if (errorClear.length > 1) return { error: errorClear };

            // Extrai tabelas
            const tableMultas = await page.$$(tablesMultas);
            const tableDados = await page.$$(tablesDados);
            const tablePagamento = await page.$$(tablesPagamento);

            if (!tableMultas.length || !tableDados.length || !tablePagamento.length) {
                throw new Error('Não foi possível localizar as tabelas de multas/dados/pagamento');
            }

            // Dados do condutor
            const linha1 = await tableDados[1].$$eval('tr', trs => trs.map(tr => tr.innerText));
            const condutor = linha1[0].split('\n');

            // Multas
            const linha2 = await tableMultas[0].$$eval('tr', trs => trs.map(tr => tr.innerText));
            const multas = linha2[0].split('\n');

            // Pagamento
            const dadosPagamento = await tableDados[2].$$eval('tr', trs => trs.map(tr => tr.innerText));
            const pagamento = dadosPagamento[0].split('\n');

            const linha4 = await tablePagamento[1].$$eval('tr', trs => trs.map(tr => tr.innerText));
            const codigoBarras = linha4[0].split('\n')[0];

            // Monta array de multas
            const object_multa = [] as any;
            for (let i = 0; i < multas.length; i++) {
                const element = multas[i].split('\t');
                const orgao = element[0];
                const valor = element[2];
                if (typeof valor === 'string') {
                    const valor_decimal: number = Number(valor.replace(/[^0-9,]/g, '').replace(',', '.'));
                    object_multa.push({ orgao: orgao, valor: valor_decimal });
                }
            }

            // Monta objeto final
            const dados = {
                multas: object_multa,
                dados: [
                    {
                        nome: condutor[1].trim(),
                        documento: condutor[4].trim(),
                        nosso_numero: condutor[9].trim(),
                        codigo_barras: codigoBarras.trim(),
                        renavam: pagamento[3].split('\t')[0].trim(),
                        data_vencimento: pagamento[4].split('\t')[0].trim(),
                        data_emissao: pagamento[5].split('\t')[0].trim(),
                        valor: utils.convertStringToDecimal(pagamento[8].split('\t')[0].trim())
                    }
                ]
            };

            return {
                placa,
                renavam,
                ...dados
            };

        } catch (err) {
            console.error('Erro scraping PB:', err);
            throw err;
        } finally {
            if (browser) await browser.close();
        }
    }
}

export const pb = new PB();
