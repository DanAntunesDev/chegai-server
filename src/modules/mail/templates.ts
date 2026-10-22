function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function invitationEmail(params: { barbershop: string; name: string | null; link: string }) {
  const greeting = params.name ? `Olá, ${params.name}!` : 'Olá!';
  const subject = `Seu acesso ao painel da ${params.barbershop}`;
  const text = [
    greeting,
    '',
    `Você foi convidado para acessar o painel da ${params.barbershop}.`,
    `Crie sua senha pelo link abaixo (válido por 7 dias):`,
    params.link,
  ].join('\n');
  const html = `
    <p>${escapeHtml(greeting)}</p>
    <p>Você foi convidado para acessar o painel da <strong>${escapeHtml(params.barbershop)}</strong>.</p>
    <p><a href="${escapeHtml(params.link)}">Criar minha senha</a> (link válido por 7 dias)</p>
  `;

  return { subject, text, html };
}
