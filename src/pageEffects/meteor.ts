import Phaser from 'phaser'
import { PageInfo, setBackgroundAndCreateDomObjects } from '../modhelper'
import { breakUp, PageObject } from '../arcadepageobject'
import { kioskConfig } from '../kioskConfig'

const mySceneConfig: Phaser.Types.Scenes.SettingsConfig = {
    active: true,
    key: 'PageScene',
}

export function doPageEffect(pageInfo: PageInfo): Phaser.Scene {
    const pageScene = new PageScene(pageInfo)
    pageInfo.game!.scene.add(mySceneConfig.key!, pageScene)
    return pageScene
}

const Speed = 300
// Sprite sheet is 1020x105, six frames laid out horizontally => 170x105 per frame.
const FRAME_WIDTH = 170
const FRAME_HEIGHT = 105
const FIRE_TINTS = [0xffff66, 0xffcc33, 0xff8800, 0xff3300, 0xff0000]
// Points awarded for smashing a whole page element vs. one of its fragments.
const POINTS_ELEMENT = 50
const POINTS_FRAGMENT = 10

export class PageScene extends Phaser.Scene {
    meteor!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody
    pageObjects!: Phaser.GameObjects.Group
    floor!: Phaser.Physics.Arcade.Image
    fireBurst!: Phaser.GameObjects.Particles.ParticleEmitter
    trail!: Phaser.GameObjects.Particles.ParticleEmitter
    scoreText!: Phaser.GameObjects.Text
    timeText?: Phaser.GameObjects.Text
    keys = new Set<string>()
    dragging = false

    // Bonus-round / hand-off-from-squad-game state.
    private embedded = false
    private seconds = 10
    private score = 0
    private introDone = false     // true once the implosion has assembled the meteor
    private bonusEnded = false

    constructor(public pageInfo: PageInfo) {
        super(mySceneConfig)
    }

    preload() {
        this.load.spritesheet('meteor', '/assets/meteor.png', { frameWidth: FRAME_WIDTH, frameHeight: FRAME_HEIGHT })
        this.load.image('fire', '/assets/particles/muzzleflash6.png')
        this.load.audio('smash', ['/assets/audio/glass-smash-6266.mp3', '/assets/audio/glass-smash-6266.ogg'])
    }

    create() {
        const { width, height } = this.sys.game.canvas

        this.embedded = kioskConfig.embed
        this.seconds = kioskConfig.seconds || 10

        const { domArcadeBackgroundRects, domArcadeImages } = setBackgroundAndCreateDomObjects(this, this.pageInfo)
        this.pageObjects = this.physics.add.group()
            .addMultiple(domArcadeBackgroundRects)
            .addMultiple(domArcadeImages)
        domArcadeBackgroundRects.forEach(o => o.body.setAllowGravity(false))
        domArcadeImages.forEach(o => o.body.setAllowGravity(false))

        // Default spinning animation across all six frames at 5fps.
        this.anims.create({
            key: 'spin',
            frames: this.anims.generateFrameNumbers('meteor', { start: 0, end: 5 }),
            frameRate: 5,
            repeat: -1,
        })

        // Meteor spawns at a random spot (not dead center) and stays hidden and
        // still until the reverse-explosion implosion assembles it into being.
        const scale = (height * 0.16) / FRAME_HEIGHT
        const mx = Phaser.Math.Between(Math.round(width * 0.2), Math.round(width * 0.8))
        const my = Phaser.Math.Between(Math.round(height * 0.2), Math.round(height * 0.8))
        this.meteor = this.physics.add.sprite(mx, my, 'meteor')
            .play('spin')
            .setScale(scale)
            .setDepth(10)
            .setVisible(false)
        this.meteor.body.setAllowGravity(false)
        this.meteor.body.setDamping(true)
        this.meteor.body.setDrag(0.4)
        this.meteor.body.setMaxVelocity(Speed, Speed)
        this.meteor.body.setVelocity(0, 0)

        // Fiery trail that follows the meteor (held until it is revealed).
        this.trail = this.add.particles(0, 0, 'fire', {
            speed: { min: 30, max: 90 },
            angle: { min: 0, max: 360 },
            scale: { start: 0.9, end: 0 },
            alpha: { start: 0.85, end: 0 },
            lifespan: { min: 250, max: 550 },
            blendMode: 'ADD',
            frequency: 18,
            quantity: 2,
            tint: FIRE_TINTS,
            emitting: false,
        })
        this.trail.startFollow(this.meteor)

        // One-shot fiery burst fired at each impact point (and the assembly snap).
        this.fireBurst = this.add.particles(0, 0, 'fire', {
            speed: { min: 80, max: 240 },
            angle: { min: 0, max: 360 },
            scale: { start: 1.1, end: 0 },
            alpha: { start: 1, end: 0 },
            lifespan: { min: 300, max: 600 },
            blendMode: 'ADD',
            tint: FIRE_TINTS,
            emitting: false,
        })

        // Keyboard capture (same pattern as godzilla / wreckingball).
        const gameKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])
        const onKeyDown = (e: KeyboardEvent) => { if (gameKeys.has(e.key)) this.keys.add(e.key) }
        const onKeyUp   = (e: KeyboardEvent) => { if (gameKeys.has(e.key)) this.keys.delete(e.key) }
        window.addEventListener('keydown', onKeyDown, { capture: true })
        window.addEventListener('keyup',   onKeyUp,   { capture: true })
        window.addEventListener('blur',    () => this.keys.clear())
        this.events.once(Phaser.Core.Events.DESTROY, () => {
            window.removeEventListener('keydown', onKeyDown, { capture: true })
            window.removeEventListener('keyup',   onKeyUp,   { capture: true })
        })

        // Thick static floor to prevent tunneling.
        this.floor = this.physics.add.image(width / 2, height + 25, '__DEFAULT')
            .setDisplaySize(width, 50)
            .setVisible(false)
        ;(this.floor.body as Phaser.Physics.Arcade.Body).setImmovable(true).setAllowGravity(false)

        // Mouse / touch drag (only once the meteor has assembled).
        this.input.on('pointerdown', () => { this.dragging = true })
        this.input.on('pointerup',   () => { this.dragging = false })
        this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
            if (this.dragging && this.introDone) {
                this.meteor.setPosition(p.x, p.y)
                this.meteor.body.reset(p.x, p.y)
            }
        })

        // Score HUD (and, when driven as a timed bonus round, a countdown).
        this.scoreText = this.add.text(16, 12, 'SCORE 0', {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: '28px', color: '#ffffff', stroke: '#000000', strokeThickness: 6,
        }).setScrollFactor(0).setDepth(100)
        if (this.embedded) {
            this.timeText = this.add.text(width - 16, 12, `⏱ ${this.seconds}`, {
                fontFamily: 'Arial Black, Arial, sans-serif',
                fontSize: '28px', color: '#ffe11a', stroke: '#000000', strokeThickness: 6,
            }).setOrigin(1, 0).setScrollFactor(0).setDepth(100)
        }

        // Reverse-explosion: shards fly inward and reassemble into the meteor.
        this.introImplosion(mx, my, scale, () => this.revealMeteor())
    }

    // Slices the meteor's first frame into a grid of shards, scatters them
    // outward, then tweens each inward to its home slot so the meteor appears to
    // reassemble from an explosion played backwards.
    private introImplosion(mx: number, my: number, scale: number, onComplete: () => void) {
        const cols = 6, rows = 4
        const tex = this.textures.get('meteor')
        const frame0 = tex.get(0)
        const baseX = frame0.cutX, baseY = frame0.cutY
        const sw = FRAME_WIDTH / cols
        const sh = FRAME_HEIGHT / rows
        const shards: Phaser.GameObjects.Image[] = []
        let pending = cols * rows

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const name = `meteor-imp-${r}-${c}`
                if (!tex.has(name)) tex.add(name, 0, baseX + c * sw, baseY + r * sh, sw, sh)
                const homeX = mx + (c * sw + sw / 2 - FRAME_WIDTH / 2) * scale
                const homeY = my + (r * sh + sh / 2 - FRAME_HEIGHT / 2) * scale
                const a = Math.random() * Math.PI * 2
                const d = 220 + Math.random() * 280
                const shard = this.add.image(homeX + Math.cos(a) * d, homeY + Math.sin(a) * d, 'meteor', name)
                    .setScale(scale).setDepth(11).setAlpha(0)
                shards.push(shard)
                this.tweens.add({
                    targets: shard,
                    x: homeX, y: homeY,
                    alpha: { from: 0, to: 1 },
                    angle: { from: (Math.random() - 0.5) * 420, to: 0 },
                    duration: 640 + Math.random() * 260,
                    delay: Math.random() * 140,
                    ease: 'Cubic.easeIn',    // accelerate inward — an implosion
                    onComplete: () => {
                        pending -= 1
                        if (pending === 0) {
                            shards.forEach(s => s.destroy())
                            this.fireBurst.explode(22, mx, my)
                            onComplete()
                        }
                    },
                })
            }
        }
    }

    private revealMeteor() {
        this.meteor.setVisible(true)
        const angle = Math.random() * Math.PI * 2
        this.meteor.body.setVelocity(Math.cos(angle) * Speed, Math.sin(angle) * Speed)
        this.trail.start()
        this.introDone = true
        this.postToParent({ type: 'ready' })
        if (this.embedded) this.startBonusTimer()
    }

    // Embedded bonus round: count the 10 seconds down, then report the score.
    private startBonusTimer() {
        let remaining = this.seconds
        this.timeText?.setText(`⏱ ${remaining}`)
        this.time.addEvent({
            delay: 1000,
            repeat: this.seconds - 1,
            callback: () => {
                remaining -= 1
                this.timeText?.setText(`⏱ ${Math.max(0, remaining)}`)
                if (remaining <= 0) this.finish()
            },
        })
    }

    private finish() {
        if (this.bonusEnded) return
        this.bonusEnded = true
        this.dragging = false
        this.meteor.body.setVelocity(0, 0)
        this.postToParent({ type: 'done', score: this.score })
    }

    private postToParent(payload: Record<string, unknown>) {
        if (typeof window !== 'undefined' && window.parent && window.parent !== window)
            window.parent.postMessage({ source: 'meteor-smash', ...payload }, '*')
    }

    update() {
        if (!this.introDone) return
        const body = this.meteor.body

        if (this.dragging) {
            body.setVelocity(0, 0)
        } else if (this.keys.size > 0) {
            const vx = this.keys.has('ArrowLeft') ? -Speed : this.keys.has('ArrowRight') ? Speed : 0
            const vy = this.keys.has('ArrowUp')   ? -Speed : this.keys.has('ArrowDown')  ? Speed : 0
            body.setVelocity(vx, vy)
        } else {
            // Wander: bounce off world edges by reversing velocity only when moving toward the wall.
            const { width, height } = this.sys.game.canvas
            const hw = this.meteor.displayWidth / 2
            const hh = this.meteor.displayHeight / 2
            if (this.meteor.x - hw <= 0 && body.velocity.x < 0) {
                body.setVelocityX(-body.velocity.x)
                this.meteor.x = hw
            } else if (this.meteor.x + hw >= width && body.velocity.x > 0) {
                body.setVelocityX(-body.velocity.x)
                this.meteor.x = width - hw
            }
            if (this.meteor.y - hh <= 0 && body.velocity.y < 0) {
                body.setVelocityY(-body.velocity.y)
                this.meteor.y = hh
            } else if (this.meteor.y + hh >= height && body.velocity.y > 0) {
                body.setVelocityY(-body.velocity.y)
                this.meteor.y = height - hh
            }
        }

        // Smash page objects on contact.
        this.physics.overlap(
            this.meteor,
            this.pageObjects,
            this._onSmash as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback,
            undefined,
            this
        )
    }

    private _lastSmashSound = 0

    private _onSmash(_meteor: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody, pageObject: PageObject) {
        this.pageObjects.remove(pageObject, false, false)
        const now = this.time.now
        if (now - this._lastSmashSound > 400) {
            this.sound.play('smash')
            this._lastSmashSound = now
        }
        const pieces = breakUp(this.meteor.x, this.meteor.y, pageObject)
        this.fireBurst.explode(16, this.meteor.x, this.meteor.y)
        // Whole elements are named "domArcadeImage-3"; their fragments carry a
        // ".n" suffix and are worth fewer points.
        this.addScore(pageObject.name?.includes('.') ? POINTS_FRAGMENT : POINTS_ELEMENT)
        pageObject.destroy()
        pieces?.forEach(p => {
            // Launch each piece away from the meteor's center.
            const dx = p.x - this.meteor.x
            const dy = p.y - this.meteor.y
            const len = Math.sqrt(dx * dx + dy * dy) || 1
            const speed = 200 + Math.random() * 150
            p.body.setVelocity((dx / len) * speed, (dy / len) * speed)
            p.body.setCollideWorldBounds(true)
            p.body.setBounce(0.5)
            p.body.setDragY(90)
            p.body.setAllowGravity(false)
            this.physics.add.collider(p, this.floor, () => {
                p.body.setVelocityY(-Math.abs(p.body.velocity.y) * 0.5)
            })
            this.time.delayedCall(2000, () => {
                if (p.active && !this.pageObjects.contains(p)) {
                    this.pageObjects.add(p)
                }
            })
        })
    }

    private addScore(n: number) {
        this.score += n
        this.scoreText.setText(`SCORE ${this.score}`)
    }
}
