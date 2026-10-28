import { useState } from 'react'
import type { Lang } from './types'
import { formatCode, looksLikeCode } from './cloud'

export type SyncState = 'idle' | 'saving' | 'ok' | 'error'

interface Props {
  lang: Lang
  code: string | null
  sync: SyncState
  at: number | null
  hasContent: boolean
  onCreate: () => Promise<string | null>
  onSaveNow: () => void
  onForget: () => void
  onRestore: (code: string, prev: boolean) => Promise<string | null>
  onClose: () => void
}

const TXT = {
  fr: {
    title: 'Sauvegarde en ligne',
    intro: 'Vos schémas sont gardés dans ce navigateur : si vous changez d’ordinateur ou effacez les données du navigateur, ils disparaissent. La sauvegarde en ligne en garde une copie, retrouvable avec un code. Pas de compte, pas de mot de passe.',
    create: 'Créer ma sauvegarde en ligne',
    creating: 'Création…',
    codeLabel: 'Votre code de reprise',
    keep: 'Notez-le (photo, cahier, mail à vous-même). Il ouvre ce schéma sur n’importe quel appareil. Quiconque connaît ce code peut lire et remplacer le schéma : ne le partagez pas.',
    copy: 'Copier le code',
    copied: 'Code copié',
    state: { idle: 'En attente de modification', saving: 'Sauvegarde…', ok: 'Sauvegardé', error: 'Échec : la copie en ligne n’est pas à jour (hors connexion ?)' },
    at: 'à',
    now: 'Sauvegarder maintenant',
    forget: 'Arrêter la sauvegarde sur cet appareil',
    forgetHelp: 'La copie en ligne reste disponible avec le code, mais ce navigateur ne la met plus à jour.',
    restoreTitle: 'Reprendre avec un code',
    restoreHelp: 'Remplace le schéma affiché par la copie en ligne, et continue de la mettre à jour.',
    placeholder: 'XXXX-XXXX-XXXX',
    restore: 'Reprendre',
    prev: 'Version d’il y a au moins une heure (pour rattraper une erreur)',
    empty: 'Dessinez d’abord quelque chose : un schéma vide n’est pas sauvegardé.',
    close: 'Fermer',
  },
  en: {
    title: 'Online backup',
    intro: 'Your diagrams are kept in this browser: if you change computer or clear browser data they are gone. The online backup keeps a copy you can get back with a code. No account, no password.',
    create: 'Create my online backup',
    creating: 'Creating…',
    codeLabel: 'Your recovery code',
    keep: 'Write it down (photo, notebook, email to yourself). It opens this diagram on any device. Anyone who knows the code can read and replace the diagram: do not share it.',
    copy: 'Copy the code',
    copied: 'Code copied',
    state: { idle: 'Waiting for changes', saving: 'Saving…', ok: 'Saved', error: 'Failed: the online copy is out of date (offline?)' },
    at: 'at',
    now: 'Save now',
    forget: 'Stop backing up on this device',
    forgetHelp: 'The online copy stays available with the code, but this browser no longer updates it.',
    restoreTitle: 'Recover with a code',
    restoreHelp: 'Replaces the displayed diagram with the online copy and keeps updating it.',
    placeholder: 'XXXX-XXXX-XXXX',
    restore: 'Recover',
    prev: 'Version from at least an hour ago (to undo a mistake)',
    empty: 'Draw something first: an empty diagram is not backed up.',
    close: 'Close',
  },
}

/** Fenêtre de la sauvegarde en ligne : création du code, état de la copie, reprise d'un schéma avec un code. */
export default function CloudDialog({ lang, code, sync, at, hasContent, onCreate, onSaveNow, onForget, onRestore, onClose }: Props) {
  const t = TXT[lang]
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [input, setInput] = useState('')
  const [prev, setPrev] = useState(false)
  const [copied, setCopied] = useState(false)
  const run = async (f: () => Promise<string | null>) => { setBusy(true); setMsg(''); const e = await f(); setBusy(false); if (e) setMsg(e) }
  const time = at ? new Date(at).toLocaleTimeString(lang === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) : ''
  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog cloud" role="dialog" aria-label={t.title} onClick={(e) => e.stopPropagation()}>
        <h3>☁ {t.title}</h3>
        {!code ? (
          <>
            <p>{t.intro}</p>
            {!hasContent && <p className="muted">{t.empty}</p>}
            <div className="actions"><button className="primary" disabled={busy || !hasContent} onClick={() => run(onCreate)}>{busy ? t.creating : t.create}</button></div>
          </>
        ) : (
          <>
            <h4>{t.codeLabel}</h4>
            <div className="cloud-code" aria-live="polite">{formatCode(code)}</div>
            <p className="muted">{t.keep}</p>
            <div className="actions">
              <button onClick={() => { navigator.clipboard?.writeText(formatCode(code)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, () => {}) }}>{copied ? '✓ ' + t.copied : t.copy}</button>
              <button onClick={onSaveNow} disabled={sync === 'saving'}>{t.now}</button>
            </div>
            <p className={'cloud-state ' + sync}>● {t.state[sync]}{sync === 'ok' && time ? ` ${t.at} ${time}` : ''}</p>
            <p className="muted small"><button className="linkish" onClick={() => { if (window.confirm(t.forgetHelp)) onForget() }}>{t.forget}</button></p>
          </>
        )}
        <h4>{t.restoreTitle}</h4>
        <p className="muted small">{t.restoreHelp}</p>
        <div className="actions">
          <input className="cloud-input" value={input} placeholder={t.placeholder} spellCheck={false} autoCapitalize="characters" onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && looksLikeCode(input)) run(() => onRestore(input, prev)) }} aria-label={t.restoreTitle} />
          <button disabled={busy || !looksLikeCode(input)} onClick={() => run(() => onRestore(input, prev))}>{t.restore}</button>
        </div>
        <label className="chk keep small"><input type="checkbox" checked={prev} onChange={(e) => setPrev(e.target.checked)} /> {t.prev}</label>
        {msg && <p className="cloud-msg" role="alert">{msg}</p>}
        <div className="actions"><button onClick={onClose}>{t.close}</button></div>
      </div>
    </div>
  )
}

