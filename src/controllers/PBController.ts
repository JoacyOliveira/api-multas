import utils from '../utils/utils';
import puppeteer from 'puppeteer';
import validation from '../validations/validation';

import { Request, Response } from 'express';

class PB {

    index = async (req: Request, res: Response) => {
        const placa = req.body.placa as string;
        const renavam = req.body.renavam as string;

        const errors = validation.generic(placa, renavam);

        if (errors) {
            return res.status(400).json(errors);
        }

        try {
            const multas = await this.scrap(placa, renavam);
            res.status(200).json(multas);
        } catch (e: any) {
            res.status(500).json({ message: 'Erro ao consultar DETRAN PB', error: e.message });
        }
    }

    scrap = async (placa: string, renavam: string) => {

        const browser = await puppeteer.launch({
            headless: process.env.NODE_ENV === 'production' ? 'new' : false,
            slowMo: process.env.NODE_ENV === 'production' ? 0 : 50,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas'
            ]
        });

        try {
            const page = await browser.newPage();

            // Timeout aumentado para 30s
            await page.goto(`${process.env.PB_URL}/BBDT_MULTABOLETO_CLIENTE/MultaBoleto?placa=${placa}&renavam=${renavam}&opcao=I&display=web&redirect=ok`, { 
                waitUntil: 'networkidle2', 
                timeout: 30000 
            });

            const tablesMultas = 'table[width="648"]';
            const tablesDados = 'table[width="650"]';
            const tablesPagamento = 'table[width="647"]';
            const errorSelect = 'table[width="644"] td[height="92"]';

            // Verifica se retornou erro de RENAVAM
            const errorRenavam = await page.$$eval(errorSelect, tds => tds.map(td => td.innerText));
            const errorClear = errorRenavam[1]?.replace(/(\r\n|\n|\r)/gm, "") || '';

            if (errorClear.length > 1) {
                return { error: errorClear };
            }

            const tableMultas = await page.$$(tablesMultas);
            const tableDados = await page.$$(tablesDados);
            const tablePagamento = await page.$$(tablesPagamento);

            // Extrai dados do condutor
            const linha1 = await tableDados[1].$$eval('tr', trs => trs.map(tr => tr.innerText));
            const condutor = linha1[0].split('\n');

            // Extrai multas
            const linha2 = await tableMultas[0].$$eval('tr', trs => trs.map(tr => tr.innerText));
            const multas = linha2[0].split('\n');

            // Extrai dados de pagamento
            const dadosPagamento = await tableDados[2].$$eval('tr', trs => trs.map(tr => tr.innerText));
            const pagamento = dadosPagamento[0].split('\n');

            // Código de barras
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
                    object_multa.push({ orgao, valor: valor_decimal });
                }
            }

            const dados = {
                "multas": object_multa,
                "dados": [
                    {
                        "nome": condutor[1].trim(),
                        "documento": condutor[4].trim(),
                        "nosso_numero": condutor[9].trim(),
                        "codigo_barras": codigoBarras.trim(),
                        "renavam": pagamento[3].split('\t')[0].trim(),
                        "data_vencimento": pagamento[4].split('\t')[0].trim(),
                        "data_emissao": pagamento[5].split('\t')[0].trim(),
                        "valor": utils.convertStringToDecimal(pagamento[8].split('\t')[0].trim())
                    }
                ]
            };

            const resultado = {
                "placa": placa,
                "renavam": renavam,
                ...dados
            };

            return { resultado };

        } catch (err) {
            throw new Error(`Erro no Puppeteer: ${err}`);
        } finally {
            await browser.close();
        }
    };
}

export const pb = new PB();
