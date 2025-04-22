/**
 * Handles the screen recording functionality.
 * Toggles the screen recording state and updates the UI accordingly.
 * Starts or stops the screen recording based on the recording state.
 */
export async function handleRecordScreen() {
    this.flags.isScreenRecording = !this.flags.isScreenRecording;
    const button = this.buttons.recordScreenButton;

    // Update the button's active state class
    button.classList.toggle("active", this.flags.isScreenRecording);

    // Update the button text based on the recording state
    button.innerHTML = this.flags.isScreenRecording ? "Stop" : "Record";

    if (this.flags.isScreenRecording) {
        // Start screen recording
        if (this.activeButton?.current === button) {
            this.activeButton = { current: button };
        }
        await recordScreen.call(this, button);
    } else {
        // Stop screen recording
        stopScreenRecording.call(this);
    }
}

/**
 * Toggles the recording state between pause and resume.
 * Updates the UI accordingly.
 */
export function resumeOrPauseRecording() {
    if (!this.mediaRecorder) {
        console.warn("MediaRecorder not initialized.");
        return;
    }

    const button = this.buttons.pauseResumeButton;
    // remove pauseResumeButton style class
    this.buttons.pauseResumeButton.classList.remove("disabled-button");
    this.buttons.pauseResumeButton.classList.add("cesium-button");

    if (this.mediaRecorder.state === "recording") {
        // Pause the recording
        this.mediaRecorder.pause();
        console.log("Recording paused.");
        button.innerHTML = "Resume";
    } else if (this.mediaRecorder.state === "paused") {
        // Resume the recording
        this.mediaRecorder.resume();
        console.log("Recording resumed.");
        button.innerHTML = "Pause";
    } else {
        console.warn(`Cannot pause/resume recording in state: ${this.mediaRecorder.state}`);
    }
}

/**
 * Starts the screen recording process with PIP preview.
 * @param {HTMLElement} button - The button element that triggered the recording.
 */
async function recordScreen(button) {
    try {
        // Request screen capture
        const displayMediaOptions = {
            video: {
                displaySurface: "browser",
                frameRate: { ideal: 60, max: 60 },
                height: { ideal: 1080 },
                width: { ideal: 1920 },
            },
            audio: false,
            preferCurrentTab: true,
        };
        this.stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

        // Create PIP preview
        this.pipVideo = document.createElement('video');
        this.pipVideo.srcObject = this.stream;
        this.pipVideo.autoplay = true;
        this.pipVideo.muted = true;

        // Request PIP mode
        try {
            await this.pipVideo.play();
            await this.pipVideo.requestPictureInPicture();
        } catch (pipError) {
            console.warn("PIP mode failed:", pipError);
        }

        // Create MediaRecorder (same as before)
        const options = { mimeType: "video/webm; codecs=vp8" };
        this.mediaRecorder = new MediaRecorder(this.stream, options);
        this.chunks = [];

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.chunks.push(event.data);
            }
        };

        this.mediaRecorder.onstop = () => {
            // Close PIP when recording stops
            if (document.pictureInPictureElement) {
                document.exitPictureInPicture();
            }

            const blob = new Blob(this.chunks, { type: "video/webm" });
            this.chunks = [];

            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.style.display = "none";
            a.href = url;
            a.download = "screen-recording.webm";
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);

            // Clean up video element
            if (this.pipVideo) {
                this.pipVideo.remove();
                this.pipVideo = null;
            }

            // Disable the Pause/Resume button after stopping
            this.buttons.pauseResumeButton.disabled = true;
            this.buttons.pauseResumeButton.classList.remove("cesium-button"); // Apply disabled styles
            this.buttons.pauseResumeButton.classList.add("disabled-button"); // Apply disabled styles
            this.buttons.pauseResumeButton.innerHTML = "Pause";
        };

        this.mediaRecorder.start();
        console.log("Recording started");

        // Enable the Pause/Resume button
        this.buttons.pauseResumeButton.disabled = false;
        this.buttons.pauseResumeButton.classList.remove("disabled-button"); // Remove disabled styles
        this.buttons.pauseResumeButton.classList.add("cesium-button"); // Apply enabled styles
        this.buttons.pauseResumeButton.innerHTML = "Pause";

        this.stream.getVideoTracks()[0].addEventListener("ended", () => {
            this.flags.isScreenRecording = false;
            stopScreenRecording.call(this);
        });
    } catch (err) {
        console.error("Error accessing screen capture:", err);
        this.flags.isScreenRecording = false;
        button.classList.toggle("active", this.flags.isScreenRecording);
        button.innerHTML = "Record";
    }
}

/**
 * Modified stop function to handle PIP cleanup
 */
function stopScreenRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
        this.mediaRecorder.stop();
        console.log("Recording stopped");
    }

    // Close PIP if it's still open
    if (document.pictureInPictureElement) {
        document.exitPictureInPicture();
    }

    if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
    }

    // Clean up video element if it exists
    if (this.pipVideo) {
        this.pipVideo.remove();
        this.pipVideo = null;
    }

    // Disable the Pause/Resume button
    if (this.buttons.pauseResumeButton) {
        this.buttons.pauseResumeButton.disabled = true;
        this.buttons.pauseResumeButton.classList.remove("cesium-button"); // Remove enabled styles
        this.buttons.pauseResumeButton.classList.add("disabled-button"); // Apply disabled styles
        this.buttons.pauseResumeButton.innerHTML = "Pause";
    }
}