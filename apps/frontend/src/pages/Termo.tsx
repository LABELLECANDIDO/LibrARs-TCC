import { TERMO_VERSAO } from '@/lib/consent'

/**
 * Termo de Consentimento Livre e Esclarecido (TCLE) da pesquisa.
 * Página pública: o link aparece na caixa de consentimento do cadastro e da
 * primeira gravação. Ao mudar o texto, atualize TERMO_VERSAO em lib/consent.ts.
 */
export default function Termo() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900">Termo de Consentimento Livre e Esclarecido</h1>
      <p className="text-xs text-gray-400 mt-1">Versão {TERMO_VERSAO}</p>

      <div className="mt-6 space-y-6 text-sm text-gray-700 leading-relaxed">
        <section>
          <h2 className="font-bold text-gray-900 mb-1">1. Sobre a pesquisa</h2>
          <p>
            Você está sendo convidado(a) a participar de uma pesquisa de Trabalho de Conclusão de
            Curso em Ciência da Computação da Faculdade Nova Roma, conduzida por Labelle Cândido sob
            orientação do Prof. MSc. Henning Summer. O objetivo é desenvolver e avaliar um sistema
            que reconhece sinais da Língua Brasileira de Sinais (Libras) pela câmera.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-gray-900 mb-1">2. O que é coletado</h2>
          <p>
            A plataforma guarda apenas <strong>números</strong> calculados no seu próprio aparelho:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>
              <strong>Pontos das mãos:</strong> as coordenadas de 21 pontos de cada mão durante os
              sinais.
            </li>
            <li>
              <strong>Pontos do rosto e dos ombros:</strong> as coordenadas do nariz, dos olhos, dos
              cantos da boca e dos dois ombros, usadas para saber onde a mão está em relação ao
              corpo.
            </li>
            <li>
              <strong>Dados de perfil:</strong> sexo, faixa etária, nível de surdez e conhecimento de
              Libras, informados no cadastro.
            </li>
            <li>
              <strong>Dados de uso:</strong> quais sinais foram pedidos e reconhecidos, o tempo de
              resposta e as respostas do questionário de opinião.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-bold text-gray-900 mb-1">3. O que NÃO é coletado</h2>
          <p>
            <strong>Nenhum vídeo, foto ou áudio é gravado ou enviado ao servidor da pesquisa.</strong>{' '}
            A imagem da câmera é processada no seu aparelho e descartada; só os pontos (números)
            são guardados. Não é possível reconstruir seu rosto a partir desses pontos. Na chamada
            em tempo real, o vídeo e o áudio vão diretamente para a outra pessoa da chamada e não
            são gravados pela plataforma.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-gray-900 mb-1">4. Como os dados são usados</h2>
          <p>
            Os dados são usados somente para fins acadêmicos e científicos: treinar e avaliar o
            reconhecimento de sinais e compor os resultados do trabalho. Nas análises e
            publicações, cada participante aparece apenas por um identificador anônimo (por exemplo,
            P01), sem nome ou e-mail.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-gray-900 mb-1">5. Participação voluntária</h2>
          <p>
            Sua participação é voluntária e sem custo. Você pode desistir a qualquer momento, sem
            qualquer prejuízo, e pedir a exclusão dos seus dados. Você também pode apagar suas
            próprias gravações na Biblioteca da plataforma.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-gray-900 mb-1">6. Contato</h2>
          <p>
            Dúvidas ou pedidos de exclusão de dados: Labelle Cândido —{' '}
            <a href="mailto:labelleecandido@gmail.com" className="text-[#2E75B6] underline">
              labelleecandido@gmail.com
            </a>
            .
          </p>
        </section>

        <section className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <p>
            Ao marcar a caixa <em>“Aceito doar os pontos do meu corpo e das mãos (números, não
            vídeo) para a pesquisa”</em>, você declara que leu e entendeu este termo e concorda em
            participar. A data, a hora e a versão do termo aceito ficam registradas.
          </p>
        </section>
      </div>
    </div>
  )
}
