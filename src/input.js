const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

export class Input {
  constructor(options) {
    this.element = options.element
    this.joystick = options.joystick
    this.joystickKnob = options.joystickKnob
    this.onLook = options.onLook || (() => {})
    this.onBreak = options.onBreak || (() => {})
    this.onPlace = options.onPlace || (() => {})
    this.onToggleFly = options.onToggleFly || (() => {})
    this.onSelect = options.onSelect || (() => {})
    this.onPause = options.onPause || (() => {})
    this.onInteract = options.onInteract || (() => {})
    this.onJump = options.onJump || (() => {})
    this.sensitivity = options.sensitivity || 0.0022
    this.touchSensitivity = options.touchSensitivity || 0.0042

    this.active = false
    this.keys = new Set()
    this.jumpHeld = false
    this.joystickVector = { x: 0, y: 0 }
    this.isTouch = options.isTouch || false
    this.lookPointer = null
    this.lookStart = null
    this.moved = 0
    this.lastTap = 0
    this.joystickPointer = null
    this.joystickCenter = { x: 0, y: 0 }
    this.breakHeld = false

    this.bind()
  }

  setActive(active) {
    this.active = active
    if (!active) this.reset()
  }

  reset() {
    this.keys.clear()
    this.jumpHeld = false
    this.joystickVector.x = 0
    this.joystickVector.y = 0
    this.joystickKnob?.style.setProperty('transform', 'translate(-50%, -50%)')
    this.lookPointer = null
  }

  bind() {
    window.addEventListener('keydown', (event) => {
      if (!this.active) return
      const code = event.code
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(code)) event.preventDefault()
      if (event.repeat) return
      if (code === 'Escape') {
        this.onPause()
        return
      }
      if (code === 'KeyF') {
        this.onToggleFly()
        return
      }
      if (code.startsWith('Digit')) {
        const index = Number(code.slice(5)) - 1
        if (index >= 0 && index < 9) this.onSelect(index)
        return
      }
      this.keys.add(code)
      if (code === 'Space') this.onJump()
    })

    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code)
    })

    window.addEventListener('blur', () => {
      this.keys.clear()
      this.jumpHeld = false
      this.joystickVector.x = 0
      this.joystickVector.y = 0
    })

    this.element.addEventListener('contextmenu', (event) => event.preventDefault())

    this.element.addEventListener('pointerdown', (event) => {
      if (!this.active) return
      this.onInteract()
      if (event.pointerType === 'mouse') {
        if (document.pointerLockElement !== this.element) {
          this.requestLock()
          return
        }
        if (event.button === 0) this.onBreak()
        else if (event.button === 2) this.onPlace()
        return
      }
      if (this.lookPointer !== null) return
      this.lookPointer = event.pointerId
      this.lookStart = { x: event.clientX, y: event.clientY, time: performance.now() }
      this.moved = 0
      try { this.element.setPointerCapture(event.pointerId) } catch {}
    })

    this.element.addEventListener('pointermove', (event) => {
      if (!this.active) return
      if (event.pointerType === 'mouse') {
        if (document.pointerLockElement === this.element) {
          this.onLook(event.movementX * this.sensitivity, event.movementY * this.sensitivity)
        }
        return
      }
      if (this.lookPointer !== event.pointerId || !this.lookStart) return
      const dx = event.clientX - this.lookStart.x
      const dy = event.clientY - this.lookStart.y
      this.lookStart.x = event.clientX
      this.lookStart.y = event.clientY
      this.moved += Math.abs(dx) + Math.abs(dy)
      this.onLook(dx * this.touchSensitivity, dy * this.touchSensitivity)
    })

    const endLook = (event) => {
      if (event.pointerType === 'mouse') return
      if (this.lookPointer !== event.pointerId) return
      const duration = performance.now() - (this.lookStart?.time ?? 0)
      if (this.moved < 7 && duration < 220) this.onBreak()
      this.lookPointer = null
      this.lookStart = null
    }
    this.element.addEventListener('pointerup', endLook)
    this.element.addEventListener('pointercancel', endLook)

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.element && this.active) {
        this.keys.clear()
        this.jumpHeld = false
      }
    })

    this.element.addEventListener('wheel', (event) => {
      if (!this.active) return
      event.preventDefault()
      this.onSelect(event.deltaY > 0 ? 1 : -1, true)
    }, { passive: false })

    this.setupJoystick()
    this.setupButtons()
  }

  requestLock() {
    try {
      const result = this.element.requestPointerLock?.()
      if (result?.catch) result.catch(() => {})
    } catch {}
  }

  setupJoystick() {
    if (!this.joystick) return
    const update = (event) => {
      const rect = this.joystick.getBoundingClientRect()
      const radius = rect.width * 0.34
      const dx = event.clientX - (rect.left + rect.width / 2)
      const dy = event.clientY - (rect.top + rect.height / 2)
      const length = Math.hypot(dx, dy)
      const scale = length > radius ? radius / length : 1
      const x = dx * scale
      const y = dy * scale
      this.joystickKnob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`
      const nx = x / radius
      const ny = y / radius
      const dead = 0.14
      const mag = Math.hypot(nx, ny)
      if (mag < dead) {
        this.joystickVector.x = 0
        this.joystickVector.y = 0
      } else {
        const normalized = Math.min(1, (mag - dead) / (1 - dead)) / mag
        this.joystickVector.x = clamp(nx * normalized, -1, 1)
        this.joystickVector.y = clamp(-ny * normalized, -1, 1)
      }
    }
    const release = (event) => {
      if (this.joystickPointer !== event.pointerId) return
      this.joystickPointer = null
      this.joystickVector.x = 0
      this.joystickVector.y = 0
      this.joystickKnob.style.transform = 'translate(-50%, -50%)'
    }
    this.joystick.addEventListener('pointerdown', (event) => {
      if (!this.active) return
      event.preventDefault()
      event.stopPropagation()
      this.onInteract()
      this.joystickPointer = event.pointerId
      try { this.joystick.setPointerCapture(event.pointerId) } catch {}
      update(event)
    })
    this.joystick.addEventListener('pointermove', (event) => {
      if (this.joystickPointer === event.pointerId) update(event)
    })
    this.joystick.addEventListener('pointerup', release)
    this.joystick.addEventListener('pointercancel', release)
  }

  setupButtons() {
    const hold = (selector, action) => {
      const button = document.querySelector(selector)
      if (!button) return
      let timeout = 0
      let interval = 0
      const stop = (event) => {
        if (event) event.preventDefault()
        clearTimeout(timeout)
        clearInterval(interval)
        button.classList.remove('pressed')
      }
      button.addEventListener('pointerdown', (event) => {
        if (!this.active) return
        event.preventDefault()
        event.stopPropagation()
        this.onInteract()
        button.classList.add('pressed')
        action()
        timeout = window.setTimeout(() => {
          interval = window.setInterval(action, 170)
        }, 320)
      })
      button.addEventListener('pointerup', stop)
      button.addEventListener('pointercancel', stop)
      button.addEventListener('pointerleave', stop)
    }

    hold('#break-btn', () => this.onBreak())
    hold('#place-btn', () => this.onPlace())

    const jump = document.querySelector('#jump-btn')
    if (jump) {
      const down = (event) => {
        if (!this.active) return
        event.preventDefault()
        event.stopPropagation()
        this.onInteract()
        this.jumpHeld = true
        jump.classList.add('pressed')
        this.onJump()
      }
      const up = (event) => {
        event?.preventDefault()
        this.jumpHeld = false
        jump.classList.remove('pressed')
      }
      jump.addEventListener('pointerdown', down)
      jump.addEventListener('pointerup', up)
      jump.addEventListener('pointercancel', up)
      jump.addEventListener('pointerleave', up)
    }

    document.querySelector('#fly-btn')?.addEventListener('click', (event) => {
      event.stopPropagation()
      if (!this.active) return
      this.onToggleFly()
    })
  }

  getState() {
    const keyForward = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0)
    const keyStrafe = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0)
    const joystickMagnitude = Math.hypot(this.joystickVector.x, this.joystickVector.y)
    return {
      forward: clamp(keyForward + this.joystickVector.y, -1, 1),
      strafe: clamp(keyStrafe + this.joystickVector.x, -1, 1),
      sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || joystickMagnitude > 0.94,
      descend: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      jump: this.jumpHeld || this.keys.has('Space'),
      joystickMagnitude
    }
  }
}
