import { spriteLines, type Sprite } from '@/lib/cast';
import { SPRITE_PROFILES } from '@/lib/sprite-profiles';
import './sprite-profile.css';

function ProfileField({ label, children }: { label: string; children: React.ReactNode }) {
  return <section className="sprite-profile-field"><h3>{label}</h3><div>{children}</div></section>;
}

function CharacterMeter({ label, value, maximum }: { label: string; value: number; maximum: number }) {
  return <div className="sprite-profile-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={value}>
    <strong>{label}</strong>
    <span className="sprite-profile-boxes" aria-hidden="true">{Array.from({length:maximum},(_,i)=><span key={i} data-filled={i < value || undefined} />)}</span>
    <span>{value}/{maximum}</span>
  </div>;
}

export default function SpriteProfile({ sprite, role, awayMessage, aimProfile }: {
  sprite: Sprite; role: string; awayMessage?: string; aimProfile?: string;
}) {
  const profile = SPRITE_PROFILES[sprite.art];
  return <article className="sprite-profile" tabIndex={0} aria-label={`${sprite.name}’s character profile`}>
    <header className="sprite-profile-hero">
      <div className="sprite-profile-portrait">
        {/* The original still artwork keeps the profile readable with motion paused. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/2006/cast/${sprite.art}.png`} alt="" width={48} height={72} />
      </div>
      <div className="sprite-profile-identity">
        <p>{profile ? '2006 — The Game' : '2006 — The Show'}</p>
        <h2>{sprite.name}</h2>
        <span className="sprite-profile-handle">{sprite.screenName}</span>
      </div>
      {profile && <div className="sprite-profile-vitals">
        <CharacterMeter label="HP" value={profile.hp} maximum={5} />
        <CharacterMeter label="XP, baby" value={profile.xp} maximum={10} />
      </div>}
    </header>
    {profile && <>
      <dl className="sprite-profile-meta">
        <div><dt>Character name</dt><dd>{profile.characterName}</dd></div>
        <div><dt>A/S/L in 2006</dt><dd>{profile.asl}</dd></div>
        {profile.favoriteDay && <div><dt>Favorite day of ’06</dt><dd>{profile.favoriteDay}</dd></div>}
      </dl>
      <div className="sprite-profile-grid">
        <div className="sprite-profile-main">
          <ProfileField label="Who even are you?"><p>{profile.description}</p></ProfileField>
          {profile.starterKit.length > 0 && <ProfileField label="Starter kit"><ul>{profile.starterKit.map(item=><li key={item}>{item}</li>)}</ul></ProfileField>}
          <ProfileField label="Stats"><table><thead><tr><th scope="col">Skill</th><th scope="col">Bonus</th></tr></thead><tbody>{profile.stats.map(stat=><tr key={stat.name}><th scope="row">{stat.name}</th><td>{stat.bonus}</td></tr>)}</tbody></table></ProfileField>
        </div>
        <div className="sprite-profile-details">
          <ProfileField label="2006 brand"><p>{profile.archetype}</p></ProfileField>
          <ProfileField label="Nicknames"><p>{profile.nicknames}</p></ProfileField>
          <ProfileField label="Who’s sharing your earbud?"><p>{profile.crush}</p></ProfileField>
          <ProfileField label="Theme song"><p>{profile.themeSong}</p></ProfileField>
          <ProfileField label="What’s your deal, bro?"><p>{profile.problem}</p></ProfileField>
        </div>
      </div>
      {profile.conditions.length > 0 && <section className="sprite-profile-conditions" aria-label="Character conditions"><h3>Conditions</h3><ul>{profile.conditions.map(condition=><li key={condition}>{condition}</li>)}</ul></section>}
    </>}
    <section className="sprite-profile-catchphrases" aria-labelledby={`sprite-${sprite.art}-lines`}>
      <h3 id={`sprite-${sprite.art}-lines`}>In their own words</h3>
      <dl>{spriteLines(sprite).map((line,i)=><div key={i}><dt>{['Celebrate','Bummer','Extra'][i]}</dt><dd>{line}</dd></div>)}</dl>
    </section>
    <footer className="sprite-profile-footer">
      <p><strong>On the show:</strong> {role}</p>
      {(aimProfile || awayMessage && !awayMessage.startsWith('[')) && <details><summary>AIM profile &amp; away message</summary>
        {awayMessage && !awayMessage.startsWith('[') && <p><strong>Away message</strong>{awayMessage}</p>}
        {aimProfile && <p><strong>Profile</strong>{aimProfile}</p>}
      </details>}
    </footer>
  </article>;
}
