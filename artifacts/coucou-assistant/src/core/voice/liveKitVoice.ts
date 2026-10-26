import type { Room } from "livekit-client";

interface LiveKitTokenResponse {
  serverUrl: string;
  participantToken: string;
  roomName: string;
}

export class LiveKitVoiceSession {
  private room: Room | null = null;
  private audioElements: HTMLAudioElement[] = [];
  private active = false;

  get isActive() {
    return this.active;
  }

  async start(onStatus: (status: "listening" | "speaking" | "idle") => void): Promise<void> {
    if (this.active) return;
    const response = await fetch("/api/iris/livekit/token", { method: "POST" });
    const payload = await response.json().catch(() => null) as Partial<LiveKitTokenResponse> | { error?: string } | null;
    if (!response.ok) {
      throw new Error(payload && "error" in payload && payload.error
        ? payload.error
        : "Não foi possível iniciar a sessão de voz.");
    }
    if (!payload || !("serverUrl" in payload) || !payload.serverUrl || !payload.participantToken) {
      throw new Error("O servidor devolveu dados de sessão inválidos.");
    }

    const { Room: LiveKitRoom, RoomEvent, Track } = await import("livekit-client");
    const room = new LiveKitRoom({ adaptiveStream: true, dynacast: true });
    this.room = room;
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio) return;
      const audio = track.attach() as HTMLAudioElement;
      audio.autoplay = true;
      audio.setAttribute("playsinline", "");
      audio.dataset.irisLiveKitAudio = "true";
      audio.style.display = "none";
      document.body.appendChild(audio);
      this.audioElements.push(audio);
      void audio.play().catch(() => undefined);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((element) => element.remove());
      onStatus("listening");
    });
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const assistantSpeaking = speakers.some(
        (participant) => participant.identity !== room.localParticipant.identity,
      );
      onStatus(assistantSpeaking ? "speaking" : "listening");
    });
    room.on(RoomEvent.Disconnected, () => {
      this.active = false;
      this.removeAudioElements();
      onStatus("idle");
    });

    try {
      await room.connect(payload.serverUrl, payload.participantToken);
      await room.startAudio();
      await room.localParticipant.setMicrophoneEnabled(true);
      this.active = true;
      onStatus("listening");
    } catch (error) {
      this.room = null;
      this.removeAudioElements();
      await room.disconnect();
      throw error;
    }
  }

  async stop(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.active = false;
    if (room) {
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      await room.disconnect();
    }
    this.removeAudioElements();
  }

  private removeAudioElements() {
    for (const audio of this.audioElements) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    }
    this.audioElements = [];
  }
}
