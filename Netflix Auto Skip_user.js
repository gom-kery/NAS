// ==UserScript==
// @name         v2.8.5 - Netflix Auto Skip
// @namespace    https://github.com/
// @version      2.8.5
// @description  Netflix 오프닝 및 크레딧 자동 스킵
// @author       Kuhn
// @match        https://www.netflix.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {

    'use strict';

    // ============================================================
    // [PROJECT] Netflix Auto Skip
    // [VERSION] v2.8.5
    // [UPDATED] 20260828_02:08 KST
    //
    // [CHANGE]
    // - 기존 크레딧 판단·유도 시간을 유지하고 다음 화 버튼 미발견 시 ↓ 키 1회로 컨트롤러 표시 보조
    // - 키 입력 후 50ms를 목표로 원래 볼륨·음소거 복원, 복원 완료 전 다음 화 클릭 방지
    // - 자동 표시 실패 시 기존 마우스 안내·재시도·최종 일시정지 유지
    // - 음소거/볼륨 0/일시정지/숨겨진 탭에서는 볼륨 키 생략
    // - 사용자 볼륨 조작 보호 및 영상 변경·OFF·설정 초기화 시 예약 작업 취소
    // - 오프닝·설정창·스타일·저장 구조·타임라인 마커 등 나머지 기능 변경 없음
    // ============================================================


    // ============================================================
    // [SECTION 1] BASIC CONFIGURATION
    // ============================================================

    const SCRIPT_NAME =
        'Netflix Auto Skip';


    const VERSION =
        '2.8.5';


    const STORAGE_KEY =
        'netflixAutoActionTimerSettings';


    const BUTTON_POSITION_KEY =
        'netflix_auto_timer_button_position';


    const DEFAULT_BUTTON_POSITION = {
        top: 80,
        right: 20
    };


    const DEBUG_PREFIX =
        '[' + SCRIPT_NAME + '][DEBUG]';


    // ============================================================
    // [SECTION 2] DEFAULT SETTINGS
    // ============================================================

    const DEFAULT_SETTINGS = {

        masterEnabled:
            true,


        intro: {

            enabled:
                true,


            startTime:
                0,


            endTime:
                60

        },


        credit: {

            enabled:
                true,


            action:
                'next',


            fallbackTime:
                null,


            fallbackSourceDuration:
                null,


            nextEpisodeRetrySeconds:
                5

        },


        button: {

            opacity:
                0.9

        },


        debug:
            false

    };


    // ============================================================
    // [SECTION 3] CONSTANTS
    // ============================================================

    const CHECK_INTERVAL =
        500;


    const PANEL_GAP =
        12;


    const DRAG_THRESHOLD =
        5;


    const OPACITY_MIN =
        0.2;


    const OPACITY_MAX =
        1;


    const OPACITY_STEP =
        0.05;


    // [크레딧 영상 보기] 클릭 후
    // [다음 화] 버튼을 최초 탐색하기까지의 시간
    const CREDIT_VIDEO_CHECK_DELAY =
        1500;


    // 반복 탐색 간격
    const NEXT_EPISODE_RETRY_INTERVAL =
        500;


    // 컨트롤러 표시용 방향키 입력 후 원래 볼륨 복원 목표 시간
    const CONTROLLER_VOLUME_RESTORE_DELAY =
        50;


    // 오프닝/줄거리 건너뛰기 단축키 처리 후
    // 동일 버튼에 대한 중복 실행을 막는 시간
    const SKIP_SHORTCUT_COOLDOWN =
        1500;


    // 합성 S 키 입력 후 실제 버튼이 사라졌는지 확인하기까지의 시간
    // 합성 KeyboardEvent는 isTrusted=false 이므로 Netflix가 무시할 수 있으며,
    // 이 경우 기존 버튼 click()을 fallback으로 사용한다.
    const SKIP_SHORTCUT_VERIFY_DELAY =
        300;


    // ============================================================
    // [SECTION 4] SELECTORS
    // ============================================================

    const SELECTORS = {

        video:
            'video',


        player:
            '[data-uia="player"]',


        skipIntro:
            'button[data-uia="player-skip-intro"]',


        skipRecap:
            'button[data-uia="player-skip-recap"]',


        watchCredits:
            'button[data-uia="watch-credits-seamless-button"]',


        nextEpisode:
            'button[data-uia="control-next"]'

    };


    // ============================================================
    // [SECTION 5] RUNTIME STATE
    // ============================================================

    let settings =
        loadSettings();


    let currentVideoElement =
        null;


    let currentVideoId =
        null;


    let automationRunning =
        false;


    let isWatchPage =
        false;


    let lastPathname =
        location.pathname;


    let introState =
        'waiting';


    let creditActionExecuted =
        false;


    let lastSkipDetectionLimit =
        null;


    let skipOperationId =
        0;


    let recapSkipHandled =
        false;


    let introSkipHandled =
        false;


    let pendingSkipType =
        null;


    let lastSkipShortcutTime =
        0;


    let nextEpisodeRetryTimer =
        null;


    let nextEpisodeRetryStartTime =
        0;


    // 다음 화 전환 시도에만 사용하는 임시 상태. localStorage에는 저장하지 않는다.
    let nextEpisodeContext = null;
    let controllerRevealOperation = null;
    let creditVideoCheckTimer = null;
    let fallbackMouseMoveHandler = null;


    let creditVideoClicked =
        false;


    let fallbackPromptActive =
        false;


    let fallbackTimeLengthWarningShown =
        false;


    let actionButton =
        null;


    let settingsPanel =
        null;


    let pauseOverlay =
        null;


    let guideOverlay =
        null;


    let fallbackTimeMarker =
        null;


    let suppressCreditForCurrentVideo =
        false;


    let isFallbackTimeMarkerDragging =
        false;


    let isPanelOpen =
        false;


    let isDragging =
        false;


    let dragStarted =
        false;


    let dragStartX =
        0;


    let dragStartY =
        0;


    let buttonStartLeft =
        0;


    let buttonStartTop =
        0;


    // ============================================================
    // [SECTION 6] STORAGE
    // ============================================================

    function deepMerge(target, source) {

        const result =
            structuredClone(target);


        if (
            !source ||
            typeof source !== 'object'
        ) {

            return result;

        }


        Object.keys(source).forEach(function (key) {

            if (

                source[key] &&
                typeof source[key] === 'object' &&
                !Array.isArray(source[key])

            ) {

                result[key] =
                    deepMerge(
                        result[key] || {},
                        source[key]
                    );

            } else {

                result[key] =
                    source[key];

            }

        });


        return result;

    }


    function loadSettings() {

        try {

            const saved =
                localStorage.getItem(
                    STORAGE_KEY
                );


            if (!saved) {

                return structuredClone(
                    DEFAULT_SETTINGS
                );

            }


            return deepMerge(

                DEFAULT_SETTINGS,

                JSON.parse(saved)

            );

        } catch (error) {

            console.warn(
                '[' + SCRIPT_NAME + '] 설정 불러오기 실패',
                error
            );


            return structuredClone(
                DEFAULT_SETTINGS
            );

        }

    }


    function saveSettings() {

        localStorage.setItem(

            STORAGE_KEY,

            JSON.stringify(settings)

        );

    }


    // ============================================================
    // [SECTION 7] DEBUG
    // ============================================================

    function debugLog() {

        if (!settings.debug) {
            return;
        }


        const args =
            Array.prototype.slice.call(arguments);


        console.log.apply(
            console,
            [DEBUG_PREFIX].concat(args)
        );

    }


    function debugWarn() {

        if (!settings.debug) {
            return;
        }


        const args =
            Array.prototype.slice.call(arguments);


        console.warn.apply(
            console,
            [DEBUG_PREFIX].concat(args)
        );

    }


    // ============================================================
    // [SECTION 8] PAGE DETECTION
    // ============================================================

    function isNetflixWatchPage() {

        return location.pathname.startsWith(
            '/watch/'
        );

    }


    function updatePageState() {

        const nextIsWatchPage =
            isNetflixWatchPage();


        if (
            nextIsWatchPage === isWatchPage
        ) {

            return;

        }


        isWatchPage =
            nextIsWatchPage;


        if (isWatchPage) {

            debugLog(
                '시청 페이지 진입'
            );


            if (settings.masterEnabled) {

                startAutomation();

            }


            setTimeout(
                maybeShowGuideOverlay,
                500
            );

        } else {

            debugLog(
                '시청 페이지 이탈'
            );


            if (guideOverlay) {

                guideOverlay.remove();
                guideOverlay = null;

            }


            stopAutomation();

        }

    }


    function detectRouteChange() {

        const currentPathname =
            location.pathname;


        if (
            currentPathname === lastPathname
        ) {

            return;

        }


        lastPathname =
            currentPathname;


        updatePageState();

    }


    // ============================================================
    // [SECTION 9] AUTOMATION START / STOP
    // ============================================================

    function startAutomation() {

        if (

            automationRunning ||
            !settings.masterEnabled

        ) {

            return;

        }


        automationRunning =
            true;


        currentVideoElement =
            null;


        currentVideoId =
            null;


        introState =
            'waiting';


        skipOperationId++;


        lastSkipDetectionLimit =
            null;


        recapSkipHandled =
            false;


        introSkipHandled =
            false;


        pendingSkipType =
            null;


        lastSkipShortcutTime =
            0;


        creditActionExecuted =
            false;


        creditVideoClicked =
            false;


        fallbackPromptActive =
            false;


        stopNextEpisodeRetry();


        debugLog(
            '자동화 시작'
        );

    }


    function stopAutomation() {

        if (!automationRunning) {

            return;

        }


        automationRunning =
            false;


        currentVideoElement =
            null;


        currentVideoId =
            null;


        introState =
            'waiting';


        skipOperationId++;


        lastSkipDetectionLimit =
            null;


        recapSkipHandled =
            false;


        introSkipHandled =
            false;


        pendingSkipType =
            null;


        lastSkipShortcutTime =
            0;


        creditActionExecuted =
            false;


        creditVideoClicked =
            false;


        fallbackPromptActive =
            false;


        stopNextEpisodeRetry();


        hidePauseOverlay();


        debugLog(
            '자동화 중지'
        );

    }


    // ============================================================
    // [SECTION 10] VIDEO DETECTION
    // ============================================================

    function findVideoElement() {

        return document.querySelector(
            SELECTORS.video
        );

    }


    function getCurrentVideoId() {

        const player =
            document.querySelector(
                SELECTORS.player
            );


        return (

            player &&
            player.dataset &&
            player.dataset.videoid

        ) || null;

    }


    function detectVideo() {

        if (!automationRunning) {

            return null;

        }


        const video =
            findVideoElement();


        if (!video) {

            return null;

        }


        const videoId =
            getCurrentVideoId();


        const isNewVideo =

            video !== currentVideoElement ||

            (
                videoId &&
                videoId !== currentVideoId
            );


        if (isNewVideo) {

            handleNewVideo(video);

        }


        return video;

    }


    function handleNewVideo(video) {

        suppressCreditForCurrentVideo =
            false;


        removeFallbackTimeMarker();

        currentVideoElement =
            video;


        currentVideoId =
            getCurrentVideoId();


        fallbackTimeLengthWarningShown =
            false;


        resetVideoAutomationState();


        debugLog(
            '새로운 영상 감지',
            {
                videoId: currentVideoId
            }
        );

    }


    // ============================================================
    // [SECTION 11] INTRO SKIP
    // ============================================================

    function getSkipTarget() {

        const recapButton =
            document.querySelector(
                SELECTORS.skipRecap
            );


        if (
            recapButton &&
            !recapSkipHandled
        ) {

            return {
                type: 'recap',
                label: '줄거리 건너뛰기',
                selector: SELECTORS.skipRecap,
                button: recapButton
            };

        }


        const introButton =
            document.querySelector(
                SELECTORS.skipIntro
            );


        if (
            introButton &&
            !introSkipHandled
        ) {

            return {
                type: 'intro',
                label: '오프닝 건너뛰기',
                selector: SELECTORS.skipIntro,
                button: introButton
            };

        }


        return null;

    }


    function markSkipHandled(type) {

        if (type === 'recap') {

            recapSkipHandled =
                true;

        }


        if (type === 'intro') {

            introSkipHandled =
                true;

        }


        debugLog(
            (type === 'recap' ? '줄거리' : '오프닝') +
            ' 건너뛰기 처리 완료',
            {
                recap:
                    recapSkipHandled,

                intro:
                    introSkipHandled
            }
        );

    }


    function dispatchNetflixSkipShortcut(targetInfo) {

        const player =
            document.querySelector(
                SELECTORS.player
            );


        const eventTarget =
            player || document;


        if (
            player &&
            typeof player.focus === 'function'
        ) {

            try {

                player.focus({
                    preventScroll: true
                });

            } catch (error) {

                player.focus();

            }

        }


        if (!eventTarget) {

            debugWarn(
                'Netflix S 단축키 입력 실패',
                '이벤트 대상 없음'
            );


            return false;

        }


        const eventOptions = {
            key: 's',
            code: 'KeyS',
            keyCode: 83,
            which: 83,
            charCode: 0,
            bubbles: true,
            cancelable: true,
            composed: true
        };


        const keydownEvent =
            new KeyboardEvent(
                'keydown',
                eventOptions
            );


        const keyupEvent =
            new KeyboardEvent(
                'keyup',
                eventOptions
            );


        let keydownDispatched =
            false;


        let keyupDispatched =
            false;


        try {

            keydownDispatched =
                eventTarget.dispatchEvent(
                    keydownEvent
                );


            keyupDispatched =
                eventTarget.dispatchEvent(
                    keyupEvent
                );

        } catch (error) {

            debugWarn(
                'Netflix S 단축키 dispatch 실패',
                error
            );


            return false;

        }


        debugLog(
            'Netflix S 단축키 입력',
            {
                skipType:
                    targetInfo.type,

                label:
                    targetInfo.label,

                target:
                    eventTarget === document
                        ? 'DOCUMENT'
                        : eventTarget.tagName,

                dataUia:
                    eventTarget.getAttribute
                        ? eventTarget.getAttribute('data-uia')
                        : null,

                keydownDispatched:
                    keydownDispatched,

                keyupDispatched:
                    keyupDispatched,

                isTrusted:
                    keydownEvent.isTrusted,

                activeElement:
                    document.activeElement &&
                    document.activeElement.getAttribute
                        ? document.activeElement.getAttribute('data-uia') || document.activeElement.tagName
                        : null
            }
        );


        return (
            keydownDispatched &&
            keyupDispatched
        );

    }


    function executeNetflixSkip(targetInfo) {

        if (
            !targetInfo ||
            pendingSkipType
        ) {

            return;

        }


        const now =
            Date.now();


        if (
            now - lastSkipShortcutTime <
            SKIP_SHORTCUT_COOLDOWN
        ) {

            return;

        }


        pendingSkipType =
            targetInfo.type;


        lastSkipShortcutTime =
            now;


        debugLog(
            targetInfo.label + ' 버튼 발견',
            {
                currentTime:
                    currentVideoElement
                        ? formatTime(currentVideoElement.currentTime)
                        : null,

                selector:
                    targetInfo.selector
            }
        );


        const operationId =
            skipOperationId;


        const skipVideo =
            currentVideoElement;


        const skipVideoId =
            currentVideoId;


        const skipPathname =
            location.pathname;


        dispatchNetflixSkipShortcut(
            targetInfo
        );


        setTimeout(
            function () {

                // 이전 영상/설정의 예약 작업은 새 처리 상태를 변경하지 않는다.
                if (operationId !== skipOperationId) {

                    return;

                }


                if (
                    !automationRunning ||
                    !settings.masterEnabled ||
                    !settings.intro.enabled ||
                    introState === 'completed' ||
                    !skipVideo ||
                    currentVideoElement !== skipVideo ||
                    findVideoElement() !== skipVideo ||
                    getCurrentVideoId() !== skipVideoId ||
                    location.pathname !== skipPathname ||
                    !Number.isFinite(skipVideo.duration) ||
                    skipVideo.duration <= 0 ||
                    !Number.isFinite(skipVideo.currentTime) ||
                    skipVideo.currentTime < 0 ||
                    skipVideo.currentTime > Math.min(skipVideo.duration * 0.20, 360)
                ) {

                    pendingSkipType =
                        null;


                    return;

                }


                const stillVisibleButton =
                    document.querySelector(
                        targetInfo.selector
                    );


                if (!stillVisibleButton) {

                    debugLog(
                        targetInfo.label +
                        ' S 단축키 처리 확인 → 버튼 사라짐'
                    );


                    markSkipHandled(
                        targetInfo.type
                    );


                    pendingSkipType =
                        null;


                    return;

                }


                debugWarn(
                    targetInfo.label +
                    ' S 단축키 후 버튼 유지 → click fallback 실행',
                    {
                        isTrustedKeyboardEvent:
                            false
                    }
                );


                try {

                    stillVisibleButton.click();


                    markSkipHandled(
                        targetInfo.type
                    );


                    debugLog(
                        targetInfo.label +
                        ' click fallback 완료'
                    );

                } catch (error) {

                    debugWarn(
                        targetInfo.label +
                        ' click fallback 실패',
                        error
                    );

                }


                pendingSkipType =
                    null;

            },
            SKIP_SHORTCUT_VERIFY_DELAY
        );

    }


    function trySkipIntro(video) {

        if (
            !settings.masterEnabled ||
            !settings.intro.enabled ||
            introState === 'completed'
        ) {

            return;

        }


        const currentTime =
            video.currentTime;


        if (
            !Number.isFinite(video.duration) ||
            video.duration <= 0 ||
            !Number.isFinite(currentTime) ||
            currentTime < 0
        ) {

            return;

        }


        const skipDetectionLimit =
            Math.min(
                video.duration * 0.20,
                360
            );


        if (
            settings.debug &&
            lastSkipDetectionLimit !== skipDetectionLimit
        ) {

            debugLog(
                '오프닝/줄거리 탐색 범위',
                {
                    duration: video.duration,
                    limit: skipDetectionLimit,
                    currentTime: currentTime
                }
            );


            lastSkipDetectionLimit =
                skipDetectionLimit;

        }


        if (
            currentTime > skipDetectionLimit
        ) {

            introState =
                'completed';


            pendingSkipType =
                null;


            debugLog(
                '오프닝/줄거리 탐색 종료',
                {
                    currentTime: currentTime,
                    limit: skipDetectionLimit
                }
            );


            return;

        }


        introState =
            'searching';


        const skipTarget =
            getSkipTarget();


        if (!skipTarget) {

            return;

        }


        executeNetflixSkip(
            skipTarget
        );

    }


    // ============================================================
    // [SECTION 12] CREDIT ACTION
    // ============================================================

    function tryCreditAction(video) {

        if (

            !settings.credit.enabled ||
            creditActionExecuted ||
            suppressCreditForCurrentVideo

        ) {

            return;

        }


        const creditButton =
            findWatchCreditsButton();


        if (!creditButton) {

            tryFallbackNextEpisode(video);

            return;

        }


        creditActionExecuted =
            true;


        debugLog(
            '크레딧 자동화 실행',
            {
                time:
                    formatTime(video.currentTime),

                action:
                    settings.credit.action
            }
        );


        startCreditsToNextEpisode();

    }


    function tryFallbackNextEpisode(video) {

        if (
            settings.credit.fallbackTime === null ||
            suppressCreditForCurrentVideo ||
            fallbackPromptActive ||
            video.currentTime < settings.credit.fallbackTime
        ) {

            return;

        }


        fallbackPromptActive = true;
        stopNextEpisodeRetry();
        const context = captureNextEpisodeContext(false);

        // 버튼이 이미 있으면 기존 다음 화 처리로 바로 연결한다.
        if (findNextEpisodeButton()) {
            startNextEpisodeRetry(context);
            return;
        }

        requestPlayerControls(context, function (result) {
            if (result.safe && findNextEpisodeButton()) {
                hidePauseOverlay();
                startNextEpisodeRetry(context);
            } else {
                showFallbackMouseMove(context);
            }
        });

    }


    function checkFallbackTimeLength(video) {

        const sourceDuration =
            settings.credit.fallbackSourceDuration;


        if (
            settings.credit.fallbackTime !== null &&
            Number.isFinite(video.duration) &&
            Number.isFinite(sourceDuration) &&
            Math.abs(video.duration - sourceDuration) >= 600
        ) {

            settings.credit.fallbackTime =
                null;


            settings.credit.fallbackSourceDuration =
                null;


            fallbackPromptActive =
                false;


            saveSettings();
            resetVideoAutomationState();


            if (settingsPanel) {

                syncSettingsToPanel();

            }


            return;

        }

        if (
            fallbackTimeLengthWarningShown ||
            settings.credit.fallbackTime === null ||
            !Number.isFinite(video.duration) ||
            settings.credit.fallbackTime < video.duration
        ) {

            return;

        }


        fallbackTimeLengthWarningShown =
            true;


        showFallbackTimeLengthWarning();

    }


    function showFallbackTimeLengthWarning() {

        const oldWarning =
            document.getElementById(
                'nat-fallback-time-warning'
            );


        if (oldWarning) {

            oldWarning.remove();

        }


        if (!actionButton) {

            return;

        }


        const rect =
            actionButton.getBoundingClientRect();


        const warning =
            document.createElement(
                'div'
            );


        warning.id =
            'nat-fallback-time-warning';


        warning.innerHTML =
            '<div class="nat-fallback-warning-title">시간 재설정 안내</div>' +
            '<div>저장된 다음 화 유도 시간이<br>영상 길이를 초과하여 시간 재설정이 필요합니다.</div>' +
            '<button type="button" aria-label="닫기">×</button>';


        warning.style.left =
            Math.min(
                window.innerWidth - 270,
                rect.right + 12
            ) + 'px';


        warning.style.top =
            Math.max(8, rect.top - 12) + 'px';


        warning.querySelector('button').addEventListener(
            'click',
            function () {

                warning.remove();

            }
        );


        document.body.appendChild(
            warning
        );


        const buttonAtTop =
            rect.top + rect.height / 2 < window.innerHeight / 2;


        warning.classList.add(
            buttonAtTop
                ? 'nat-warning-below'
                : 'nat-warning-above'
        );


        warning.style.left =
            Math.max(
                8,
                Math.min(
                    window.innerWidth - warning.offsetWidth - 8,
                    rect.left + rect.width / 2 - warning.offsetWidth / 2
                )
            ) + 'px';


        warning.style.top =
            buttonAtTop
                ? rect.bottom + 12 + 'px'
                : Math.max(8, rect.top - warning.offsetHeight - 12) + 'px';

    }


    // ============================================================
    // [SECTION 13] VIDEO CONTROL
    // ============================================================

    function pauseVideo() {

        const video =
            findVideoElement();


        if (video) {

            video.pause();


            debugLog(
                '영상 일시정지 완료'
            );

        }

    }


    // ============================================================
    // [SECTION 14] CREDITS → NEXT EPISODE
    // ============================================================

    /*
     * 자동화 흐름
     *
     * 크레딧 지정 시간 도달
     *       ↓
     * [크레딧 영상 보기] 탐색
     *       ↓
     * 발견 → 클릭
     *       ↓
     * 1500ms 대기
     *       ↓
     * [다음 화] 탐색
     *       ↓
     * 발견 → 클릭
     *
     * [다음 화] 미발견
     *       ↓
     * 설정된 '다음 버튼 탐색 시간' 동안 반복 탐색
     *       ↓
     * 발견 → 클릭
     *       ↓
     * 최종 실패 → 일시정지
     */


    function findWatchCreditsButton() {

        return document.querySelector(
            SELECTORS.watchCredits
        );

    }


    function findNextEpisodeButton() {

        const selectors = [

            SELECTORS.nextEpisode,

            'button[aria-label="다음 화"]',

            'button[aria-label="다음 에피소드"]'

        ];


        for (
            let i = 0;
            i < selectors.length;
            i++
        ) {

            const button =
                document.querySelector(
                    selectors[i]
                );


            if (button) {

                return button;

            }

        }


        return null;

    }


    function isButtonEnabled(button) {

        if (!button) {

            return false;

        }


        const ariaDisabled =
            button.getAttribute(
                'aria-disabled'
            );


        return (

            !button.disabled &&
            ariaDisabled !== 'true'

        );

    }


    function clickWatchCreditsButton() {

        const button =
            findWatchCreditsButton();


        if (!button) {

            debugLog(
                '[크레딧 영상 보기] 버튼을 찾지 못했습니다.'
            );


            return false;

        }


        debugLog(
            '[크레딧 영상 보기] 버튼 발견 → 클릭'
        );


        try {

            button.click();


            creditVideoClicked =
                true;


            showMessage(
                '✓ [크레딧 영상 보기] 클릭',
                true
            );


            return true;

        } catch (error) {

            debugWarn(
                '[크레딧 영상 보기] 클릭 실패',
                error
            );


            return false;

        }

    }


    function captureNextEpisodeContext(debugTest) {

        const context = {
            video: findVideoElement(),
            videoId: getCurrentVideoId(),
            pathname: location.pathname,
            debugTest: !!debugTest,
            revealAttempted: false,
            revealBlocked: false
        };
        nextEpisodeContext = context;
        return context;

    }


    function isSameNextEpisodeVideo(context) {

        return !!context && !!context.video && context.video.isConnected &&
            findVideoElement() === context.video &&
            location.pathname === context.pathname &&
            getCurrentVideoId() === context.videoId;

    }


    function isNextEpisodeContextActive(context) {

        return context === nextEpisodeContext && isSameNextEpisodeVideo(context) &&
            isNetflixWatchPage() && automationRunning && settings.masterEnabled &&
            (context.debugTest ? settings.debug : settings.credit.enabled && !suppressCreditForCurrentVideo);

    }


    function clearFallbackMouseMove() {

        if (fallbackMouseMoveHandler) {
            document.removeEventListener('mousemove', fallbackMouseMoveHandler, true);
            fallbackMouseMoveHandler = null;
        }

    }


    function showFallbackMouseMove(context) {

        if (!isNextEpisodeContextActive(context)) return;
        clearFallbackMouseMove();
        showFallbackOverlay();
        fallbackMouseMoveHandler = function () {
            clearFallbackMouseMove();
            hidePauseOverlay();
            if (!isNextEpisodeContextActive(context)) return;
            // 사용자가 기존 안내에 따라 재개한 경로. 볼륨 키는 다시 보내지 않는다.
            context.revealBlocked = false;
            context.revealAttempted = true;
            startNextEpisodeRetry(context);
        };
        document.addEventListener('mousemove', fallbackMouseMoveHandler, true);

    }


    function controllerRevealTime() {

        return typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now() : Date.now();

    }


    function finishPlayerControls(operation, cancelled, reason) {

        if (controllerRevealOperation !== operation) return;
        // dispatchEvent 내부에서 OFF/영상 변경이 발생하면 keyup 뒤에 음량을 정리한다.
        if (operation.dispatching) {
            operation.cancelRequested = true;
            operation.cancelReason = reason;
            return;
        }
        clearTimeout(operation.timer);
        for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart']) {
            document.removeEventListener(type, operation.onInput, true);
        }
        document.removeEventListener('visibilitychange', operation.onVisibility);
        controllerRevealOperation = null;

        const video = operation.context.video;
        const original = operation.original;
        const sameVolume = function (state) {
            return state && Math.abs(video.volume - state.volume) <= 0.0001 && video.muted === state.muted;
        };
        const result = { status: 'RESTORED', safe: false, reason: reason || null,
            requestedDelayMs: CONTROLLER_VOLUME_RESTORE_DELAY,
            actualDelayMs: Math.round(controllerRevealTime() - operation.startedAt),
            original: original };

        if (!isSameNextEpisodeVideo(operation.context)) {
            result.status = 'SKIPPED_VIDEO_CHANGED';
        } else if (operation.userVolumeInput) {
            result.status = 'SKIPPED_USER_VOLUME_INPUT';
        } else if (!sameVolume(operation.afterKey) && !sameVolume(original)) {
            // 방향키 직후와 다른 음량은 외부/사용자 변경일 수 있으므로 덮어쓰지 않는다.
            result.status = 'SKIPPED_VOLUME_CHANGED';
        } else {
            try {
                if (Math.abs(video.volume - original.volume) > 0.0001) video.volume = original.volume;
                if (video.muted !== original.muted) video.muted = original.muted;
                result.status = sameVolume(original) ? 'RESTORED' : 'RESTORE_MISMATCH';
            } catch (error) {
                result.status = 'RESTORE_ERROR';
                result.error = String(error && error.message || error);
            }
        }
        result.actualDelayMs = Math.round(controllerRevealTime() - operation.startedAt);
        if (isSameNextEpisodeVideo(operation.context)) {
            result.actual = { volume: video.volume, muted: video.muted };
        }
        result.safe = !cancelled && !operation.dispatchError && result.status === 'RESTORED';
        operation.context.revealBlocked = !result.safe;
        debugLog('컨트롤러 표시 보조: 볼륨 복원 결과', result);
        if (cancelled) debugLog('컨트롤러 표시 보조 취소', { reason: reason });
        if (isSameNextEpisodeVideo(operation.context) &&
            ['RESTORE_ERROR', 'RESTORE_MISMATCH', 'SKIPPED_VOLUME_CHANGED'].includes(result.status)) {
            debugWarn('컨트롤러 표시 보조: 원래 볼륨 복원 미확인', result);
            showMessage('볼륨 복원이 확인되지 않았습니다. 현재 음량을 확인하세요.', false);
        }
        if (!cancelled && isNextEpisodeContextActive(operation.context)) operation.done(result);

    }


    function requestPlayerControls(context, done) {

        if (!isNextEpisodeContextActive(context)) return;
        if (context.revealAttempted || controllerRevealOperation) {
            done({ safe: false, status: 'ALREADY_ATTEMPTED' });
            return;
        }
        context.revealAttempted = true;
        const video = context.video;
        const player = document.querySelector(SELECTORS.player);
        let skipReason = null;
        if (!player) skipReason = '플레이어 없음';
        else if (video.muted) skipReason = '음소거';
        else if (!Number.isFinite(video.volume) || video.volume <= 0 || video.volume > 1) skipReason = '볼륨 0 또는 유효하지 않은 값';
        else if (video.paused || video.ended) skipReason = '일시정지 또는 재생 종료';
        else if (document.visibilityState === 'hidden') skipReason = '숨겨진 탭';
        if (skipReason) {
            debugLog('컨트롤러 표시 보조 생략', { reason: skipReason });
            done({ safe: false, status: 'SKIPPED' });
            return;
        }

        const operation = {
            context: context, done: done, timer: null, dispatching: false,
            userVolumeInput: false, dispatchError: false, cancelRequested: false,
            original: { volume: video.volume, muted: video.muted },
            afterKey: null, startedAt: controllerRevealTime()
        };
        operation.onInput = function (event) {
            if (!event.isTrusted) return;
            if (event.type === 'keydown') {
                if (['ArrowUp', 'ArrowDown', 'm', 'M'].includes(event.key)) operation.userVolumeInput = true;
                return;
            }
            for (let node = event.target; node && node !== document; node = node.parentElement) {
                if (typeof node.getAttribute !== 'function') continue;
                const label = [node.getAttribute('data-uia'), node.getAttribute('aria-label'), node.className, node.id].join(' ');
                if (/volume|볼륨|음량|音量/i.test(label)) {
                    operation.userVolumeInput = true;
                    return;
                }
            }
        };
        operation.onVisibility = function () {
            if (document.visibilityState === 'hidden') finishPlayerControls(operation, false, '탭 숨김');
        };
        controllerRevealOperation = operation;
        for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart']) {
            document.addEventListener(type, operation.onInput, true);
        }
        document.addEventListener('visibilitychange', operation.onVisibility);
        const options = { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40,
            charCode: 0, bubbles: true, cancelable: true, composed: true };
        operation.startedAt = controllerRevealTime();
        debugLog('컨트롤러 표시 보조: 볼륨 ↓ 키 1회', {
            restoreDelayMs: CONTROLLER_VOLUME_RESTORE_DELAY, volume: video.volume
        });
        operation.dispatching = true;
        try {
            try {
                player.dispatchEvent(new KeyboardEvent('keydown', options));
            } finally {
                player.dispatchEvent(new KeyboardEvent('keyup', options));
            }
        } catch (error) {
            operation.dispatchError = true;
            debugWarn('컨트롤러 표시 보조: 방향키 입력 실패', error);
        } finally {
            operation.afterKey = { volume: video.volume, muted: video.muted };
            operation.dispatching = false;
        }
        if (operation.cancelRequested) {
            finishPlayerControls(operation, true, operation.cancelReason);
        } else if (operation.dispatchError) {
            finishPlayerControls(operation, false, '방향키 입력 오류');
        } else {
            operation.timer = setTimeout(function () {
                finishPlayerControls(operation, false, '50ms 복원');
            }, Math.max(0, CONTROLLER_VOLUME_RESTORE_DELAY - (controllerRevealTime() - operation.startedAt)));
        }

    }


    function startCreditsToNextEpisode() {

        stopNextEpisodeRetry();
        hidePauseOverlay();
        const context = captureNextEpisodeContext(false);


        debugLog(
            'Credits → Next Episode 자동화 시작'
        );


        const creditButton =
            findWatchCreditsButton();


        if (creditButton) {

            clickWatchCreditsButton();


            creditVideoCheckTimer = setTimeout(

                function () {

                    creditVideoCheckTimer = null;
                    if (!isNextEpisodeContextActive(context)) {

                        return;

                    }


                    startNextEpisodeRetry(context);

                },

                CREDIT_VIDEO_CHECK_DELAY

            );


            return;

        }


        /*
         * [크레딧 영상 보기] 버튼이 이미 사라졌거나
         * 현재 화면이 일반 플레이어 상태인 경우
         *
         * 바로 [다음 화] 탐색을 시작한다.
         */

        debugLog(
            '[크레딧 영상 보기] 버튼 없음 → [다음 화] 바로 탐색'
        );


        startNextEpisodeRetry(context);

    }


    function startNextEpisodeRetry(context) {

        if (!context) {
            stopNextEpisodeRetry();
            context = captureNextEpisodeContext(false);
        }
        if (!isNextEpisodeContextActive(context)) return;
        if (nextEpisodeRetryTimer) clearTimeout(nextEpisodeRetryTimer);
        nextEpisodeRetryTimer = null;
        clearFallbackMouseMove();
        nextEpisodeRetryStartTime = Date.now();
        attemptNextEpisode();

    }


    function attemptNextEpisode() {

        if (

            !isNextEpisodeContextActive(nextEpisodeContext)

        ) {

            stopNextEpisodeRetry();


            return;

        }


        const context = nextEpisodeContext;
        // 복원 타이머가 끝나기 전에는 나타난 버튼도 클릭하지 않는다.
        const button = !controllerRevealOperation && !context.revealBlocked
            ? findNextEpisodeButton() : null;


        if (button) {

            debugLog(
                '[다음 화] 버튼 발견'
            );


            if (
                isButtonEnabled(button)
            ) {

                debugLog(
                    '[다음 화] 버튼 활성화 → 클릭'
                );


                try {

                    button.click();


                    showMessage(
                        '✓ 다음 에피소드로 이동합니다.',
                        true
                    );


                    stopNextEpisodeRetry();


                    return;

                } catch (error) {

                    debugWarn(
                        '[다음 화] 버튼 클릭 실패',
                        error
                    );

                }

            } else {

                debugLog(
                    '[다음 화] 버튼이 비활성화 상태'
                );

            }

        } else {

            debugLog(
                '[다음 화] 버튼 탐색 중'
            );

            if (!context.revealAttempted && !controllerRevealOperation) {
                requestPlayerControls(context, function () {
                    // 기존 500ms 탐색 주기와 제한 시간을 유지한다.
                });
                if (!isNextEpisodeContextActive(context)) return;
            }

        }


        const retrySeconds =
            Number(
                settings.credit.nextEpisodeRetrySeconds
            ) || 5;


        const elapsed =
            Date.now() -
            nextEpisodeRetryStartTime;


        const retryLimit =
            retrySeconds * 1000;


        if (
            elapsed >= retryLimit
        ) {

            debugWarn(
                '[다음 화] 버튼 탐색 시간 초과',
                retrySeconds + '초'
            );


            pauseVideo();


            showPauseOverlay();


            stopNextEpisodeRetry();


            return;

        }


        nextEpisodeRetryTimer =
            setTimeout(

                attemptNextEpisode,

                NEXT_EPISODE_RETRY_INTERVAL

            );

    }


    function stopNextEpisodeRetry() {

        // 컨텍스트부터 무효화하여 정리 중 콜백이 다음 화로 이어지지 않게 한다.
        nextEpisodeContext = null;
        if (creditVideoCheckTimer) clearTimeout(creditVideoCheckTimer);
        creditVideoCheckTimer = null;
        clearFallbackMouseMove();
        if (controllerRevealOperation) {
            finishPlayerControls(controllerRevealOperation, true, '전환 시도 중지');
        }

        if (nextEpisodeRetryTimer) {

            clearTimeout(
                nextEpisodeRetryTimer
            );


            nextEpisodeRetryTimer =
                null;

        }


        nextEpisodeRetryStartTime =
            0;

    }


    // ============================================================
    // [SECTION 15] T KEY DEBUG TEST
    // ============================================================

    function runDebugCreditsTest() {

        if (!settings.debug) {

            return;

        }


        debugLog(
            '=============================================='
        );


        debugLog(
            'T 키 디버그 테스트 시작'
        );


        debugLog(
            'Credits → Next Episode'
        );


        debugLog(
            '=============================================='
        );


        showMessage(
            '▶ T 키 테스트 시작'
        );


        // 첫 정기 검사 전 T 키를 눌러도 영상 초기화가 이 테스트를 취소하지 않게 한다.
        detectVideo();


        stopNextEpisodeRetry();
        hidePauseOverlay();
        const context = captureNextEpisodeContext(true);


        const clicked =
            clickWatchCreditsButton();


        if (!clicked) {

            /*
             * 크레딧 영상 보기 버튼이 없는 경우
             * 일반 플레이어의 다음 화 버튼을 바로 확인한다.
             */

            debugLog(
                '[크레딧 영상 보기] 버튼 없음 → [다음 화] 바로 테스트'
            );


            startNextEpisodeRetry(context);


            return;

        }


        creditVideoCheckTimer = setTimeout(

            function () {

                creditVideoCheckTimer = null;
                if (!isNextEpisodeContextActive(context)) {

                    return;

                }


                startNextEpisodeRetry(context);

            },

            CREDIT_VIDEO_CHECK_DELAY

        );

    }


    // ============================================================
    // [SECTION 16] BUTTON POSITION
    // ============================================================

    function loadButtonPosition() {

        try {

            const saved =
                localStorage.getItem(
                    BUTTON_POSITION_KEY
                );


            if (!saved) {

                return {
                    ...DEFAULT_BUTTON_POSITION
                };

            }


            const parsed =
                JSON.parse(saved);


            return {

                top:
                    Number.isFinite(parsed.top)
                        ? parsed.top
                        : DEFAULT_BUTTON_POSITION.top,


                right:
                    Number.isFinite(parsed.right)
                        ? parsed.right
                        : DEFAULT_BUTTON_POSITION.right

            };

        } catch (error) {

            return {
                ...DEFAULT_BUTTON_POSITION
            };

        }

    }


    function saveButtonPosition(top, right) {

        localStorage.setItem(

            BUTTON_POSITION_KEY,

            JSON.stringify({

                top:
                    top,

                right:
                    right

            })

        );

    }


    function keepActionButtonInViewport() {

        if (!actionButton) {

            return;

        }


        const margin =
            8;


        const rect =
            actionButton.getBoundingClientRect();


        const left =
            Math.max(
                margin,
                Math.min(
                    window.innerWidth - rect.width - margin,
                    rect.left
                )
            );


        const top =
            Math.max(
                margin,
                Math.min(
                    window.innerHeight - rect.height - margin,
                    rect.top
                )
            );


        actionButton.style.left =
            left + 'px';


        actionButton.style.top =
            top + 'px';


        actionButton.style.right =
            'auto';


        saveButtonPosition(
            top,
            window.innerWidth - left - rect.width
        );


        if (isPanelOpen) {

            positionSettingsPanel();

        }

    }


    function getFullscreenHost() {

        return document.fullscreenElement ||
            document.webkitFullscreenElement ||
            null;

    }


    function syncFullscreenUi() {

        const host =
            getFullscreenHost() ||
            document.body;


        const uiElements =
            document.querySelectorAll(
                '#nat-action-button, #nat-settings-panel, #nat-pause-overlay, ' +
                '#nat-fallback-time-marker, #nat-guide-overlay, ' +
                '#nat-fallback-time-warning, #tm-netflix-test-message'
            );


        uiElements.forEach(
            function (element) {

                if (element !== host && element.parentElement !== host) {

                    host.appendChild(element);

                }

            }
        );

    }


    function initializeFullscreenUiSupport() {

        document.addEventListener(
            'fullscreenchange',
            syncFullscreenUi
        );


        document.addEventListener(
            'webkitfullscreenchange',
            syncFullscreenUi
        );


        if (typeof MutationObserver !== 'undefined') {

            new MutationObserver(
                function () {

                    if (getFullscreenHost()) {

                        syncFullscreenUi();

                    }

                }
            ).observe(
                document.body,
                {
                    childList: true,
                    subtree: true
                }
            );

        }


        syncFullscreenUi();

    }


    // ============================================================
    // [SECTION 17] OPACITY
    // ============================================================

    function clampOpacity(opacity) {

        return Math.max(

            OPACITY_MIN,

            Math.min(

                OPACITY_MAX,

                opacity

            )

        );

    }


    function updateButtonOpacity() {

        if (actionButton) {

            actionButton.style.opacity =
                settings.button.opacity;


            actionButton.style.background =
                settings.masterEnabled
                    ? '#e50914'
                    : '#141414F7';

        }


        if (fallbackTimeMarker) {

            fallbackTimeMarker.style.opacity =
                settings.button.opacity;

        }

    }


    function findNetflixTimeline() {

        const candidates =
            Array.from(
                document.querySelectorAll(
                    '[data-uia="timeline"], [data-uia="player-timeline"], ' +
                    '.scrubber-container, [class*="scrubber"], [class*="timeline"]'
                )
            );


        return candidates.find(
            function (element) {
                const rect =
                    element.getBoundingClientRect();


                return rect.width >= 240 && rect.height > 0;
            }
        ) || null;

    }


    function removeFallbackTimeMarker() {

        if (fallbackTimeMarker) {

            fallbackTimeMarker.remove();

            fallbackTimeMarker =
                null;

        }

    }


    function updateFallbackTimeMarker(video) {

        if (isFallbackTimeMarkerDragging) {

            return;

        }

        const shouldShow =
            settings.masterEnabled &&
            settings.credit.enabled &&
            video &&
            Number.isFinite(video.duration);


        if (!shouldShow) {

            removeFallbackTimeMarker();

            return;

        }


        const timeline =
            findNetflixTimeline();


        if (!timeline) {

            removeFallbackTimeMarker();

            return;

        }


        if (!fallbackTimeMarker) {

            fallbackTimeMarker =
                document.createElement('div');


            fallbackTimeMarker.id =
                'nat-fallback-time-marker';


            fallbackTimeMarker.setAttribute(
                'aria-label',
                '다음 화 유도 시간 설정 마커'
            );


            fallbackTimeMarker.innerHTML =
                '<span class="nat-fallback-marker-time"></span>' +
                '<span class="nat-fallback-marker-line">▼</span>';


            fallbackTimeMarker.addEventListener(
                'pointerdown',
                startFallbackTimeMarkerDrag,
                true
            );


            document.body.appendChild(
                fallbackTimeMarker
            );


            fallbackTimeMarker.style.opacity =
                settings.button.opacity;

        }


        const rect =
            timeline.getBoundingClientRect();


        const markerTime =
            settings.credit.fallbackTime === null
                ? video.currentTime
                : settings.credit.fallbackTime;


        const progress =
            Math.max(
                0,
                Math.min(
                    1,
                    markerTime / video.duration
                )
            );


        updateFallbackMarkerTime(
            markerTime
        );


        fallbackTimeMarker.style.left =
            rect.left + rect.width * progress + 'px';


        fallbackTimeMarker.style.top =
            rect.top - 39 + 'px';


        fallbackTimeMarker.classList.toggle(
            'nat-fallback-time-marker-needed',
            settings.credit.fallbackTime === null
        );

    }


    function updateFallbackMarkerTime(seconds) {

        if (!fallbackTimeMarker) {

            return;

        }


        const timeLabel =
            fallbackTimeMarker.querySelector(
                '.nat-fallback-marker-time'
            );


        if (timeLabel) {

            timeLabel.textContent =
                formatTime(
                    Math.max(0, Math.floor(seconds))
                );

        }

    }


    function startFallbackTimeMarkerDrag(event) {

        const video =
            findVideoElement();


        const timeline =
            findNetflixTimeline();


        if (!video || !timeline || !Number.isFinite(video.duration)) {

            return;

        }


        event.preventDefault();
        event.stopPropagation();


        isFallbackTimeMarkerDragging =
            true;


        const moveMarker =
            function (pointerEvent) {

                pointerEvent.preventDefault();
                pointerEvent.stopPropagation();


                const rect =
                    timeline.getBoundingClientRect();


                const progress =
                    Math.max(
                        0,
                        Math.min(
                            1,
                            (pointerEvent.clientX - rect.left) / rect.width
                        )
                    );


                updateFallbackMarkerTime(
                    video.duration * progress
                );


                fallbackTimeMarker.style.left =
                    rect.left + rect.width * progress + 'px';


                fallbackTimeMarker.style.top =
                    rect.top - 39 + 'px';

            };


        const saveMarkerTime =
            function (pointerEvent) {

                moveMarker(pointerEvent);


                document.removeEventListener(
                    'pointermove',
                    moveMarker,
                    true
                );


                document.removeEventListener(
                    'pointerup',
                    saveMarkerTime,
                    true
                );


                isFallbackTimeMarkerDragging =
                    false;


                const rect =
                    timeline.getBoundingClientRect();


                const progress =
                    Math.max(
                        0,
                        Math.min(
                            1,
                            (pointerEvent.clientX - rect.left) / rect.width
                        )
                    );


                settings.credit.fallbackTime =
                    Math.floor(video.duration * progress);


                settings.credit.fallbackSourceDuration =
                    Math.floor(video.duration);


                fallbackPromptActive =
                    false;


                saveSettings();
                resetVideoAutomationState();


                suppressCreditForCurrentVideo =
                    true;


                if (settingsPanel) {

                    syncSettingsToPanel();

                }


                updateFallbackTimeMarker(video);


                showMessage(
                    '다음 화 유도 시간이 ' +
                    formatTime(settings.credit.fallbackTime) +
                    '으로 저장되었습니다.\n다음 에피소드부터 적용됩니다.',
                    true
                );

            };


        document.addEventListener(
            'pointermove',
            moveMarker,
            true
        );


        document.addEventListener(
            'pointerup',
            saveMarkerTime,
            true
        );

    }


    function updateOpacitySlider() {

        if (!settingsPanel) {

            return;

        }


        const slider =
            settingsPanel.querySelector(
                '#nat-opacity-slider'
            );


        const value =
            settingsPanel.querySelector(
                '#nat-opacity-value'
            );


        if (slider) {

            slider.value =
                settings.button.opacity;

        }


        if (value) {

            value.textContent =
                Math.round(
                    settings.button.opacity * 100
                ) + '%';

        }

    }


    // ============================================================
    // [SECTION 18] CSS
    // ============================================================

    function createStyle() {

        if (
            document.querySelector(
                '#nat-style'
            )
        ) {

            return;

        }


        const style =
            document.createElement(
                'style'
            );


        style.id =
            'nat-style';


        style.textContent =

            '#nat-action-button {' +
                'position:fixed;' +
                'z-index:2147483647;' +
                'display:flex;' +
                'align-items:center;' +
                'justify-content:center;' +
                'width:42px;' +
                'height:42px;' +
                'padding:0;' +
                'border:none;' +
                'border-radius:50%;' +
                'background:#e50914;' +
                'color:white;' +
                'font-size:20px;' +
                'line-height:1;' +
                'cursor:grab;' +
                'user-select:none;' +
                'touch-action:none;' +
                'box-shadow:0 3px 10px rgba(0,0,0,0.5);' +
                'transition:transform 0.15s ease;' +
            '}' +

            '#nat-action-button:hover {' +
                'transform:scale(1.08);' +
            '}' +

            '#nat-fallback-time-marker {' +
                'position:fixed;' +
                'z-index:2147483647;' +
                'width:54px;' +
                'height:39px;' +
                'transform:translateX(-50%);' +
                'color:#ff9700;' +
                'font-size:39px;' +
                'font-weight:bold;' +
                'line-height:39px;' +
                'cursor:ew-resize;' +
                'user-select:none;' +
                'touch-action:none;' +
                'text-shadow:0 0 7px rgba(255,151,0,0.95);' +
            '}' +

            '#nat-fallback-time-marker .nat-fallback-marker-line {' +
                'position:absolute;' +
                'left:50%;' +
                'top:0;' +
                'transform:translateX(-50%);' +
                'pointer-events:none;' +
            '}' +

            '#nat-fallback-time-marker .nat-fallback-marker-time {' +
                'position:absolute;' +
                'left:50%;' +
                'top:-22px;' +
                'transform:translateX(-50%);' +
                'padding:1px 4px;' +
                'border-radius:3px;' +
                'background:rgba(20,20,20,0.82);' +
                'color:#ffb000;' +
                'font-size:12px;' +
                'font-weight:700;' +
                'line-height:16px;' +
                'white-space:nowrap;' +
                'pointer-events:none;' +
            '}' +

            '@keyframes nat-fallback-marker-pulse {' +
                '0%,100%{filter:drop-shadow(0 0 2px rgba(255,151,0,0.55));}' +
                '50%{filter:drop-shadow(0 0 9px rgba(255,185,0,1)) brightness(1.5);}' +
            '}' +

            '#nat-fallback-time-marker.nat-fallback-time-marker-needed {' +
                'animation:nat-fallback-marker-pulse 0.9s ease-in-out infinite;' +
            '}' +

            '#nat-guide-overlay {' +
                'position:fixed;' +
                'inset:0;' +
                'z-index:2147483645;' +
                'background:rgba(0,0,0,0.68);' +
                'color:#fff;' +
                'font-family:Arial,sans-serif;' +
            '}' +

            '.nat-guide-card {' +
                'position:fixed;' +
                'z-index:1;' +
                'width:min(230px,calc(100vw - 32px));' +
                'padding:18px;' +
                'border:1px solid rgba(255,255,255,0.16);' +
                'border-radius:14px;' +
                'background:#1f1f1f;' +
                'box-shadow:0 16px 48px rgba(0,0,0,0.55);' +
            '}' +

            '.nat-guide-spotlight {' +
                'position:fixed;' +
                'z-index:0;' +
                'border:2px solid #e50914;' +
                'border-radius:9px;' +
                'box-shadow:0 0 0 9999px rgba(0,0,0,0.12),0 0 18px rgba(229,9,20,0.9);' +
                'pointer-events:none;' +
            '}' +

            '.nat-guide-step {' +
                'margin-bottom:10px;' +
                'font-size:12px;' +
                'color:#e50914;' +
                'font-weight:bold;' +
            '}' +

            '.nat-guide-title {' +
                'margin-bottom:10px;' +
                'font-size:20px;' +
                'font-weight:bold;' +
            '}' +

            '.nat-guide-body {' +
                'min-height:72px;' +
                'font-size:14px;' +
                'line-height:1.65;' +
                'color:rgba(255,255,255,0.9);' +
            '}' +

            '.nat-guide-actions {' +
                'display:flex;' +
                'justify-content:space-between;' +
                'gap:8px;' +
                'margin-top:22px;' +
            '}' +

            '.nat-guide-actions button {' +
                'min-width:84px;' +
                'padding:9px 12px;' +
                'border:none;' +
                'border-radius:6px;' +
                'background:#444;' +
                'color:#fff;' +
                'font-weight:bold;' +
                'cursor:pointer;' +
            '}' +

            '.nat-guide-actions .nat-guide-primary {' +
                'background:#e50914;' +
            '}' +

            '@keyframes nat-threshold-blink {' +
                '0%,100%{opacity:0.2;transform:translateX(-50%) scaleY(0.8);}' +
                '50%{opacity:1;transform:translateX(-50%) scaleY(1.15);}' +
            '}' +

            '#nat-settings-panel {' +
                'position:fixed;' +
                'z-index:2147483646;' +
                'width:300px;' +
                'max-width:calc(100vw - 16px);' +
                'box-sizing:border-box;' +
                'padding:14px;' +
                'border-radius:12px;' +
                'background:rgba(20,20,20,0.97);' +
                'color:white;' +
                'box-shadow:0 8px 30px rgba(0,0,0,0.5);' +
                'font-family:Arial,sans-serif;' +
                'display:none;' +
            '}' +

            '#nat-settings-panel.nat-visible {' +
                'display:block;' +
            '}' +

            '.nat-panel-header {' +
                'display:flex;' +
                'align-items:center;' +
                'justify-content:space-between;' +
                'margin-bottom:12px;' +
                'font-size:16px;' +
                'font-weight:bold;' +
            '}' +

            '.nat-header-left {' +
                'display:flex;' +
                'align-items:center;' +
                'gap:10px;' +
            '}' +

            '.nat-close-button {' +
                'border:none;' +
                'background:transparent;' +
                'color:white;' +
                'font-size:22px;' +
                'line-height:1;' +
                'cursor:pointer;' +
            '}' +

            '.nat-status {' +
                'position:relative;' +
                'padding:10px;' +
                'margin-bottom:2px;' +
                'border-radius:8px;' +
                'background:#2b2b2b;' +
            '}' +

            '.nat-status-header {' +
                'display:flex;' +
                'align-items:center;' +
                'justify-content:space-between;' +
                'font-size:11px;' +
                'color:rgba(255,255,255,0.65);' +
            '}' +

            '.nat-status-title {' +
                'margin-top:4px;' +
                'font-size:14px;' +
                'font-weight:bold;' +
            '}' +

            '.nat-status-description {' +
                'margin-top:2px;' +
                'font-size:11px;' +
                'color:rgba(255,255,255,0.65);' +
            '}' +

            '.nat-info-button {' +
                'padding:0;' +
                'border:none;' +
                'background:transparent;' +
                'color:rgba(255,255,255,0.8);' +
                'font-size:15px;' +
                'line-height:1;' +
                'cursor:pointer;' +
            '}' +

            '.nat-help-popup {' +
                'position:fixed;' +
                'z-index:2147483647;' +
                'width:min(390px,calc(100vw - 32px));' +
                'max-height:calc(100vh - 32px);' +
                'box-sizing:border-box;' +
                'overflow-y:auto;' +
                'padding:14px;' +
                'border:1px solid rgba(255,255,255,0.18);' +
                'border-radius:10px;' +
                'background:#303030;' +
                'box-shadow:0 8px 28px rgba(0,0,0,0.55);' +
                'font-size:12px;' +
                'line-height:1.45;' +
            '}' +

            '.nat-help-popup[hidden] {' +
                'display:none;' +
            '}' +

            '.nat-help-popup-title {' +
                'margin-bottom:8px;' +
                'font-size:14px;' +
                'font-weight:700;' +
            '}' +

            '.nat-help-close-button {' +
                'position:absolute;' +
                'top:10px;' +
                'right:10px;' +
                'padding:0;' +
                'border:none;' +
                'background:transparent;' +
                'color:#fff;' +
                'font-size:19px;' +
                'line-height:1;' +
                'cursor:pointer;' +
            '}' +

            '.nat-help-popup details {' +
                'padding:7px 0;' +
                'border-top:1px solid rgba(255,255,255,0.12);' +
            '}' +

            '.nat-help-popup summary {' +
                'position:relative;' +
                'padding-right:22px;' +
                'cursor:pointer;' +
                'font-weight:700;' +
                'list-style:none;' +
            '}' +

            '.nat-help-popup summary::-webkit-details-marker {' +
                'display:none;' +
            '}' +

            '.nat-help-popup summary::after {' +
                'content:"⌄";' +
                'position:absolute;' +
                'right:2px;' +
                'top:-2px;' +
                'color:rgba(255,255,255,0.7);' +
                'font-size:16px;' +
            '}' +

            '.nat-help-popup details:not([open]) summary::after {' +
                'content:"›";' +
            '}' +

            '.nat-help-popup ul {' +
                'margin:6px 0 0 17px;' +
                'padding:0;' +
            '}' +

            '.nat-help-popup li {' +
                'margin:3px 0;' +
            '}' +

            '#nat-replay-guide-button {' +
                'padding:6px 9px;' +
                'border:none;' +
                'border-radius:5px;' +
                'background:#e50914;' +
                'color:#fff;' +
                'font-size:11px;' +
                'font-weight:bold;' +
                'cursor:pointer;' +
            '}' +

            '.nat-section {' +
                'padding:0;' +
                'font-size:calc(13px + 2pt);' +
            '}' +

            '.nat-status + .nat-section {' +
                'padding-top:10px;' +
            '}' +

            '.nat-section + .nat-section {' +
                'margin-top:0.5em;' +
                'padding-bottom:10px;' +
                'border-bottom:1px solid rgba(255,255,255,0.15);' +
            '}' +

            '.nat-section:last-child {' +
                'border-bottom:none;' +
            '}' +

            '.nat-section-header {' +
                'display:flex;' +
                'align-items:center;' +
                'justify-content:space-between;' +
                'margin-bottom:0;' +
            '}' +

            '.nat-section-title {' +
                'font-size:calc(13px + 2pt);' +
                'font-weight:bold;' +
            '}' +

            '.nat-section-toggle {' +
                'display:grid;' +
                'grid-template-columns:16px minmax(0,1fr);' +
                'align-items:center;' +
                'gap:0;' +
                'width:100%;' +
                'font-size:11px;' +
                'line-height:1.5;' +
                'white-space:nowrap;' +
                'cursor:pointer;' +
            '}' +

            '#nat-settings-panel .nat-section-toggle > input, #nat-settings-panel .nat-debug-section input {' +
                'width:13px;' +
                'height:13px;' +
                'margin:0;' +
                'justify-self:start;' +
            '}' +

            '#nat-settings-panel .nat-section-toggle > input:checked + .nat-section-title {' +
                'color:#fff;' +
            '}' +

            '#nat-settings-panel .nat-section-toggle > input:not(:checked) + .nat-section-title {' +
                'color:#888;' +
            '}' +

            '.nat-time-label-row {' +
                'display:grid;' +
                'grid-template-columns:1fr 1fr;' +
                'gap:10px;' +
                'margin-bottom:4px;' +
                'font-size:10px;' +
                'color:rgba(255,255,255,0.65);' +
            '}' +

            '.nat-time-row {' +
                'display:flex;' +
                'align-items:center;' +
                'gap:4px;' +
            '}' +

            '.nat-time-separator {' +
                'margin:0 3px;' +
                'color:rgba(255,255,255,0.65);' +
            '}' +

            '.nat-time-select {' +
                'min-width:0;' +
                'padding:5px 3px;' +
                'border:1px solid #666;' +
                'border-radius:5px;' +
                'background:#333;' +
                'color:white;' +
                'font-size:11px;' +
                'cursor:pointer;' +
            '}' +

            '.nat-time-select-minute {' +
                'width:52px;' +
            '}' +

            '.nat-time-select-second {' +
                'width:52px;' +
            '}' +

            '.nat-credit-grid {' +
                'display:grid;' +
                'grid-template-columns:1fr 1fr;' +
                'gap:10px;' +
                'align-items:end;' +
            '}' +

            '.nat-credit-label {' +
                'margin-bottom:4px;' +
                'font-size:10px;' +
                'color:rgba(255,255,255,0.65);' +
            '}' +

            '.nat-credit-time-row {' +
                'display:flex;' +
                'align-items:center;' +
                'gap:4px;' +
            '}' +

            '.nat-credit-action {' +
                'width:100%;' +
                'box-sizing:border-box;' +
                'padding:6px;' +
                'border:1px solid #666;' +
                'border-radius:5px;' +
                'background:#333;' +
                'color:white;' +
                'font-size:11px;' +
            '}' +

            '.nat-fallback-time-input {' +
                'width:48px;' +
                'min-width:0;' +
                'flex:1 1 0;' +
                'height:30px;' +
                'box-sizing:border-box;' +
                'padding:5px 3px;' +
                'border:1px solid #666;' +
                'border-radius:5px;' +
                'background:#333;' +
                'color:white;' +
                'font-size:calc(11px + 2pt);' +
                'text-align:center;' +
            '}' +

            '.nat-fallback-time-input::-webkit-inner-spin-button {' +
                '-webkit-appearance:none;' +
                'margin:0;' +
            '}' +

            '#nat-fallback-time-warning {' +
                'position:fixed;' +
                'z-index:2147483647;' +
                'width:250px;' +
                'padding:12px 32px 12px 14px;' +
                'border:1px solid #e50914;' +
                'border-radius:9px;' +
                'background:#242424;' +
                'color:#fff;' +
                'font-size:12px;' +
                'line-height:1.45;' +
                'box-shadow:0 6px 20px rgba(0,0,0,0.45);' +
            '}' +

            '#nat-fallback-time-warning::after {' +
                'content:"";' +
                'position:absolute;' +
                'left:50%;' +
                'width:14px;' +
                'height:14px;' +
                'background:#242424;' +
                'transform:rotate(45deg);' +
            '}' +

            '#nat-fallback-time-warning.nat-warning-below::after {' +
                'top:-8px;' +
                'border-left:1px solid #e50914;' +
                'border-top:1px solid #e50914;' +
            '}' +

            '#nat-fallback-time-warning.nat-warning-above::after {' +
                'bottom:-8px;' +
                'border-right:1px solid #e50914;' +
                'border-bottom:1px solid #e50914;' +
            '}' +

            '#nat-fallback-time-warning button {' +
                'position:absolute;' +
                'top:7px;' +
                'right:8px;' +
                'border:none;' +
                'background:transparent;' +
                'color:#fff;' +
                'font-size:18px;' +
                'cursor:pointer;' +
            '}' +

            '.nat-fallback-warning-title {' +
                'margin-bottom:6px;' +
                'font-size:13px;' +
                'font-weight:bold;' +
            '}' +

            '.nat-fallback-setting {' +
                'display:grid;' +
                'grid-template-columns:minmax(0,1fr) 110px;' +
                'align-items:center;' +
                'gap:8px;' +
                'margin-top:0.5em;' +
                'margin-left:calc(16px + 13px + 2pt);' +
            '}' +

            '.nat-fallback-setting-label {' +
                'flex:0 0 auto;' +
                'margin-bottom:0;' +
                'font-size:calc(11px + 2pt);' +
                'white-space:nowrap;' +
            '}' +

            '.nat-fallback-input-row {' +
                'display:flex;' +
                'align-items:center;' +
                'gap:6px;' +
                'flex:1;' +
                'min-width:0;' +
                'font-size:calc(11px + 2pt);' +
            '}' +

            '.nat-next-retry-row {' +
                'display:grid;' +
                'grid-template-columns:1fr 48px 10px 48px 30px;' +
                'align-items:center;' +
                'gap:6px;' +
                'margin-top:10px;' +
                'font-size:11px;' +
            '}' +

            '.nat-next-retry-row select {' +
                'min-width:70px;' +
                'padding:5px;' +
                'border:1px solid #666;' +
                'border-radius:5px;' +
                'background:#333;' +
                'color:white;' +
                'font-size:11px;' +
            '}' +

            '.nat-opacity-section {' +
                'padding:10px 0 0 calc(16px + 13px + 2pt);' +
            '}' +

            '.nat-opacity-header {' +
                'display:flex;' +
                'align-items:center;' +
                'justify-content:space-between;' +
                'margin-bottom:6px;' +
                'font-size:11px;' +
            '}' +

            '.nat-opacity-row {' +
                'display:grid;' +
                'grid-template-columns:1fr 42px;' +
                'align-items:center;' +
                'gap:8px;' +
            '}' +

            '#nat-opacity-slider {' +
                'width:100%;' +
                'min-width:0;' +
                'margin:0;' +
            '}' +

            '#nat-opacity-value {' +
                'font-size:11px;' +
                'text-align:right;' +
            '}' +

            '.nat-button-row {' +
                'display:flex;' +
                'gap:8px;' +
                'padding:12px 0;' +
            '}' +

            '.nat-button-row button {' +
                'flex:1;' +
                'padding:8px;' +
                'border:none;' +
                'border-radius:5px;' +
                'background:#e50914;' +
                'color:white;' +
                'font-size:11px;' +
                'font-weight:bold;' +
                'cursor:pointer;' +
            '}' +

            '.nat-button-row button:last-child {' +
                'background:#555;' +
            '}' +

            '.nat-debug-section {' +
                'padding-top:0.5em;' +
                'font-size:11px;' +
            '}' +

            '.nat-debug-section label {' +
                'display:grid;' +
                'grid-template-columns:16px minmax(0,1fr);' +
                'column-gap:calc(13px + 2pt);' +
                'align-items:center;' +
                'line-height:1.5;' +
            '}' +

            '.nat-toggle {' +
                'position:relative;' +
                'width:36px;' +
                'height:20px;' +
                'flex:0 0 auto;' +
            '}' +

            '.nat-toggle input {' +
                'width:0;' +
                'height:0;' +
                'opacity:0;' +
            '}' +

            '.nat-toggle-slider {' +
                'position:absolute;' +
                'inset:0;' +
                'border-radius:20px;' +
                'background:#555;' +
                'cursor:pointer;' +
                'transition:0.2s;' +
            '}' +

            '.nat-toggle-slider::before {' +
                'content:"";' +
                'position:absolute;' +
                'width:16px;' +
                'height:16px;' +
                'left:2px;' +
                'top:2px;' +
                'border-radius:50%;' +
                'background:white;' +
                'transition:0.2s;' +
            '}' +

            '.nat-toggle input:checked + .nat-toggle-slider {' +
                'background:#e50914;' +
            '}' +

            '.nat-toggle input:checked + .nat-toggle-slider::before {' +
                'transform:translateX(16px);' +
            '}' +

            '#nat-pause-overlay {' +
                'position:fixed;' +
                'inset:0;' +
                'z-index:2147483645;' +
                'display:flex;' +
                'align-items:center;' +
                'justify-content:center;' +
                'pointer-events:none;' +
                'opacity:0;' +
                'visibility:hidden;' +
                'transition:opacity 0.25s ease;' +
            '}' +

            '#nat-pause-overlay.nat-visible {' +
                'opacity:1;' +
                'visibility:visible;' +
            '}' +

            '.nat-pause-message {' +
                'padding:24px 40px;' +
                'border-radius:12px;' +
                'background:rgba(0,0,0,0.82);' +
                'color:white;' +
                'font-size:32px;' +
                'font-weight:700;' +
                'text-align:center;' +
            '}';


        document.head.appendChild(style);

    }


    // ============================================================
    // [SECTION 19] ACTION BUTTON
    // ============================================================

    function createActionButton() {

        if (actionButton) {

            return;

        }


        actionButton =
            document.createElement(
                'button'
            );


        actionButton.id =
            'nat-action-button';


        actionButton.type =
            'button';


        actionButton.textContent =
            '⏱';


        actionButton.title =
            'Netflix Auto Skip (우클릭: 다음 화 유도 시간 저장)';


        actionButton.style.opacity =
            settings.button.opacity;


        const position =
            loadButtonPosition();


        actionButton.style.top =
            position.top + 'px';


        actionButton.style.right =
            position.right + 'px';


        document.body.appendChild(
            actionButton
        );


        updateButtonOpacity();


        actionButton.addEventListener(
            'click',
            function (event) {

                if (dragStarted) {

                    dragStarted =
                        false;


                    return;

                }


                event.stopPropagation();


                toggleSettingsPanel();

            }
        );


        actionButton.addEventListener(
            'wheel',
            function (event) {

                event.preventDefault();


                event.stopPropagation();


                const step =
                    event.deltaY < 0
                        ? OPACITY_STEP
                        : -OPACITY_STEP;


                settings.button.opacity =
                    clampOpacity(
                        settings.button.opacity + step
                    );


                updateButtonOpacity();


                updateOpacitySlider();


                saveSettings();

            },
            {
                passive: false
            }
        );


        actionButton.addEventListener(
            'contextmenu',
            function (event) {

                event.preventDefault();
                event.stopPropagation();


                const nextEnabled =
                    !settings.masterEnabled;


                setMasterEnabled(
                    nextEnabled
                );


                updateFallbackTimeMarker(
                    nextEnabled
                        ? findVideoElement()
                        : null
                );


                showMessage(
                    nextEnabled
                        ? 'NAS 자동화가 켜졌습니다.'
                        : 'NAS 자동화가 꺼졌습니다.',
                    nextEnabled
                );

            }
        );


        makeDraggable(
            actionButton
        );

    }


    // ============================================================
    // [SECTION 20] DRAG
    // ============================================================

    function makeDraggable(button) {

        button.addEventListener(
            'mousedown',
            function (event) {

                if (event.button !== 0) {

                    return;

                }


                isDragging =
                    true;


                dragStarted =
                    false;


                dragStartX =
                    event.clientX;


                dragStartY =
                    event.clientY;


                const rect =
                    button.getBoundingClientRect();


                buttonStartLeft =
                    rect.left;


                buttonStartTop =
                    rect.top;


                event.preventDefault();

            }
        );


        document.addEventListener(
            'mousemove',
            function (event) {

                if (!isDragging) {

                    return;

                }


                const deltaX =
                    event.clientX - dragStartX;


                const deltaY =
                    event.clientY - dragStartY;


                if (

                    Math.abs(deltaX) > DRAG_THRESHOLD ||
                    Math.abs(deltaY) > DRAG_THRESHOLD

                ) {

                    dragStarted =
                        true;

                }


                if (!dragStarted) {

                    return;

                }


                const newLeft =
                    Math.max(

                        0,

                        Math.min(

                            window.innerWidth -
                            button.offsetWidth,

                            buttonStartLeft +
                            deltaX

                        )

                    );


                const newTop =
                    Math.max(

                        0,

                        Math.min(

                            window.innerHeight -
                            button.offsetHeight,

                            buttonStartTop +
                            deltaY

                        )

                    );


                button.style.left =
                    newLeft + 'px';


                button.style.top =
                    newTop + 'px';


                button.style.right =
                    'auto';


                if (isPanelOpen) {

                    positionSettingsPanel();

                }

            }
        );


        document.addEventListener(
            'mouseup',
            function () {

                if (!isDragging) {

                    return;

                }


                isDragging =
                    false;


                if (dragStarted) {

                    const rect =
                        button.getBoundingClientRect();


                    saveButtonPosition(

                        rect.top,

                        window.innerWidth -
                        rect.right

                    );

                }

            }
        );

    }


    // ============================================================
    // [SECTION 21] SETTINGS PANEL
    // ============================================================

    function createSettingsPanel() {

        if (settingsPanel) {

            return;

        }


        settingsPanel =
            document.createElement(
                'div'
            );


        settingsPanel.id =
            'nat-settings-panel';


        settingsPanel.innerHTML =

            '<div class="nat-panel-header">' +

                '<span>Netflix Auto Skip</span>' +

                '<div class="nat-header-left">' +

                    '<label class="nat-toggle" title="전체 자동화 ON/OFF">' +

                        '<input id="nat-master-enabled" type="checkbox">' +

                        '<span class="nat-toggle-slider"></span>' +

                    '</label>' +

                    '<button class="nat-close-button" id="nat-close-button" type="button">×</button>' +

                '</div>' +

            '</div>' +


            '<div class="nat-status">' +

                '<div class="nat-status-header">' +

                    '<span>현재 설정 적용 범위</span>' +

                    '<button class="nat-info-button" id="nat-info-button" type="button" title="도움말">ⓘ</button>' +

                '</div>' +

                '<div class="nat-status-title">모든 에피소드</div>' +

                '<div class="nat-help-popup" id="nat-help-popup" hidden>' +

                    '<div class="nat-help-popup-title">도움말</div>' +
                    '<button class="nat-help-close-button" id="nat-help-close-button" type="button" title="도움말 닫기">×</button>' +
                    '<details>' +
                        '<summary>오프닝 / 줄거리 스킵</summary>' +
                        '<ul><li>영상 초반부에서 넷플릭스의 ‘줄거리 건너뛰기’ 및 ‘오프닝 건너뛰기’ 버튼을 자동으로 처리합니다.</li><li>탐색 범위: 전체 영상의 20% 또는 최대 6분 중 더 짧은 구간</li></ul>' +
                    '</details>' +
                    '<details open>' +
                        '<summary>크레딧 스킵</summary>' +
                        '<ul>' +
                            '<li>\'크레딧 보기\' 버튼 감지 시 다음 화로 자동 이동합니다.</li>' +
                            '<li><strong>버튼이 없는 콘텐츠</strong><ul>' +
                                '<li>타임라인 마커(<strong>▼</strong>) 이동 또는 시간 입력으로 스킵 시점 지정</li>' +
                                '<li>설정 시간에 안내 표시 시, <strong>마우스를 움직여</strong> 컨트롤러 활성화</li>' +
                            '</ul></li>' +
                            '<li><strong>자동 초기화</strong>: 이전 영상과 재생 시간 차이가 10분 이상일 경우 초기화 (초기화 시 마커 깜빡임)</li>' +
                        '</ul>' +
                    '</details>' +
                    '<details>' +
                        '<summary>플로팅 버튼 조작</summary>' +
                        '<ul>' +
                            '<li><strong>좌클릭:</strong> 설정</li>' +
                            '<li><strong>드래그:</strong> 이동</li>' +
                            '<li><strong>휠:</strong> 투명도</li>' +
                            '<li><strong>우클릭:</strong> NAS ON/OFF</li>' +
                        '</ul>' +
                    '</details>' +

                    '<br>' +

                    '<button id="nat-replay-guide-button" type="button">안내 다시 보기</button>' +

                '</div>' +

            '</div>' +


            '<div class="nat-section">' +

                '<div class="nat-section-header">' +

                    '<label class="nat-section-toggle">' +

                        '<input id="nat-intro-enabled" type="checkbox">' +

                        '<span class="nat-section-title">　오프닝 / 줄거리 스킵</span>' +

                    '</label>' +

                '</div>' +

            '</div>' +


            '<div class="nat-section">' +

                '<div class="nat-section-header">' +

                    '<label class="nat-section-toggle">' +

                        '<input id="nat-credit-enabled" type="checkbox">' +

                        '<span class="nat-section-title">　크레딧 스킵</span>' +

                    '</label>' +

                '</div>' +

                '<div class="nat-credit-grid">' +

                '</div>' +

                '<div class="nat-fallback-setting">' +

                    '<div class="nat-fallback-setting-label">다음 화 유도 시간</div>' +

                    '<div class="nat-fallback-input-row">' +

                    '<input id="nat-fallback-minute" class="nat-fallback-time-input" type="number" min="0" max="180" placeholder="분">' +

                    '<span>:</span>' +

                    '<input id="nat-fallback-second" class="nat-fallback-time-input" type="number" min="0" max="59" placeholder="초">' +

                    '</div>' +

                '</div>' +

            '</div>' +


            '<div class="nat-opacity-section">' +

                '<div class="nat-opacity-header">' +

                    '<span>버튼 투명도</span>' +

                '</div>' +

                '<div class="nat-opacity-row">' +

                    '<input id="nat-opacity-slider" type="range" min="0.2" max="1" step="0.05">' +

                    '<span id="nat-opacity-value">90%</span>' +

                '</div>' +

            '</div>' +


            '<div class="nat-debug-section">' +

                '<label>' +

                    '<input id="nat-debug-enabled" type="checkbox">' +

                    ' 디버그 모드' +

                '</label>' +

            '</div>';


        document.body.appendChild(
            settingsPanel
        );


        bindSettingsEvents();


        syncSettingsToPanel();

    }


    // ============================================================
    // [SECTION 23] PANEL EVENTS
    // ============================================================

    function saveFallbackTime() {

        const minute =
            settingsPanel.querySelector('#nat-fallback-minute').value;


        const second =
            settingsPanel.querySelector('#nat-fallback-second').value;


        if (minute === '' && second === '') {

            settings.credit.fallbackTime =
                null;


            settings.credit.fallbackSourceDuration =
                null;

        } else {

            settings.credit.fallbackTime =
                Math.max(0, Number(minute || 0) * 60 + Number(second || 0));


            const video =
                findVideoElement();


            settings.credit.fallbackSourceDuration =
                video && Number.isFinite(video.duration)
                    ? Math.floor(video.duration)
                    : null;

        }


        fallbackPromptActive =
            false;


        saveSettings();


        resetVideoAutomationState();

    }


    function bindSettingsEvents() {

        settingsPanel
            .querySelector('#nat-close-button')
            .addEventListener(
                'click',
                function (event) {

                    event.stopPropagation();


                    closeSettingsPanel();

                }
            );


        settingsPanel
            .querySelector('#nat-master-enabled')
            .addEventListener(
                'change',
                function (event) {

                    setMasterEnabled(
                        event.target.checked
                    );

                }
            );


        settingsPanel
            .querySelector('#nat-intro-enabled')
            .addEventListener(
                'change',
                function (event) {

                    settings.intro.enabled =
                        event.target.checked;


                    saveSettings();


                    resetVideoAutomationState();

                }
            );


        settingsPanel
            .querySelector('#nat-credit-enabled')
            .addEventListener(
                'change',
                function (event) {

                    settings.credit.enabled =
                        event.target.checked;


                    saveSettings();


                    resetVideoAutomationState();

                }
            );


        settingsPanel
            .querySelector('#nat-debug-enabled')
            .addEventListener(
                'change',
                function (event) {

                    settings.debug =
                        event.target.checked;


                    saveSettings();


                    if (settings.debug) {

                        console.log(
                            '[' +
                            SCRIPT_NAME +
                            '] 디버그 모드 활성화'
                        );

                    }

                }
            );


        [
            'nat-fallback-minute',
            'nat-fallback-second'
        ].forEach(
            function (id) {

                settingsPanel.querySelector('#' + id)
                    .addEventListener(
                        'change',
                        saveFallbackTime
                    );

            }
        );


        settingsPanel
            .querySelector('#nat-replay-guide-button')
            .addEventListener(
                'click',
                function (event) {

                    event.preventDefault();
                    event.stopPropagation();
                    showGuideOverlay();

                }
            );


        settingsPanel
            .querySelector('#nat-opacity-slider')
            .addEventListener(
                'input',
                function (event) {

                    settings.button.opacity =
                        clampOpacity(
                            Number(event.target.value)
                        );


                    updateButtonOpacity();


                    updateOpacitySlider();


                    saveSettings();

                }
            );


        settingsPanel
            .querySelector('#nat-help-close-button')
            .addEventListener(
                'click',
                function (event) {

                    event.stopPropagation();


                    settingsPanel.querySelector(
                        '#nat-help-popup'
                    ).hidden =
                        true;

                }
            );


        settingsPanel
            .querySelector('#nat-info-button')
            .addEventListener(
                'click',
                function (event) {

                    event.stopPropagation();


                    const popup =
                        settingsPanel.querySelector(
                            '#nat-help-popup'
                        );


                    popup.hidden =
                        !popup.hidden;


                    if (!popup.hidden) {

                        positionHelpPopup(
                            popup
                        );

                    }

                }
            );


        settingsPanel.addEventListener(
            'click',
            function (event) {

                event.stopPropagation();

            }
        );


        document.addEventListener(
            'click',
            function () {

                const popup =
                    settingsPanel.querySelector(
                        '#nat-help-popup'
                    );


                if (popup) {

                    popup.hidden =
                        true;

                }

            }
        );

    }


    function positionHelpPopup(popup) {

        const margin =
            16;


        const panelRect =
            settingsPanel.getBoundingClientRect();


        const popupRect =
            popup.getBoundingClientRect();


        popup.style.left =
            Math.max(
                margin,
                Math.min(
                    window.innerWidth - popupRect.width - margin,
                    panelRect.right + 12
                )
            ) + 'px';


        popup.style.top =
            Math.max(
                margin,
                Math.min(
                    window.innerHeight - popupRect.height - margin,
                    panelRect.top
                )
            ) + 'px';

    }


    function setMasterEnabled(enabled) {

        settings.masterEnabled =
            enabled;


        saveSettings();


        if (enabled) {

            if (isWatchPage) {

                startAutomation();

            }

        } else {

            stopAutomation();

        }


        updateMasterToggle();


        updateButtonOpacity();


        updateFallbackTimeMarker(
            enabled
                ? findVideoElement()
                : null
        );

    }


    // ============================================================
    // [SECTION 24] PANEL DATA
    // ============================================================

    function syncSettingsToPanel() {

        if (!settingsPanel) {

            return;

        }


        settingsPanel.querySelector(
            '#nat-master-enabled'
        ).checked =
            settings.masterEnabled;


        settingsPanel.querySelector(
            '#nat-intro-enabled'
        ).checked =
            settings.intro.enabled;


        settingsPanel.querySelector(
            '#nat-credit-enabled'
        ).checked =
            settings.credit.enabled;

        settingsPanel.querySelector(
            '#nat-debug-enabled'
        ).checked =
            settings.debug;


        const fallbackTime =
            settings.credit.fallbackTime;


        settingsPanel.querySelector('#nat-fallback-minute').value =
            fallbackTime === null
                ? ''
                : String(Math.floor(fallbackTime / 60));


        settingsPanel.querySelector('#nat-fallback-second').value =
            fallbackTime === null
                ? ''
                : String(fallbackTime % 60);


        updateOpacitySlider();

    }


    function resetVideoAutomationState() {

        introState =
            'waiting';


        skipOperationId++;


        lastSkipDetectionLimit =
            null;


        recapSkipHandled =
            false;


        introSkipHandled =
            false;


        pendingSkipType =
            null;


        lastSkipShortcutTime =
            0;


        creditActionExecuted =
            false;


        creditVideoClicked =
            false;


        fallbackPromptActive =
            false;


        stopNextEpisodeRetry();


        hidePauseOverlay();

    }


    function updateMasterToggle() {

        if (!settingsPanel) {

            return;

        }


        const toggle =
            settingsPanel.querySelector(
                '#nat-master-enabled'
            );


        if (toggle) {

            toggle.checked =
                settings.masterEnabled;

        }

    }


    // ============================================================
    // [SECTION 25] PANEL OPEN / CLOSE
    // ============================================================

    function toggleSettingsPanel() {

        if (isPanelOpen) {

            closeSettingsPanel();

        } else {

            openSettingsPanel();

        }

    }


    function openSettingsPanel() {

        if (!settingsPanel) {

            return;

        }


        syncSettingsToPanel();


        settingsPanel.classList.add(
            'nat-visible'
        );


        positionSettingsPanel();


        isPanelOpen =
            true;

    }


    function closeSettingsPanel() {

        if (!settingsPanel) {

            return;

        }


        settingsPanel.classList.remove(
            'nat-visible'
        );


        isPanelOpen =
            false;

    }


    function positionSettingsPanel() {

        if (
            !settingsPanel ||
            !actionButton
        ) {

            return;

        }


        settingsPanel.style.visibility =
            'hidden';


        settingsPanel.classList.add(
            'nat-visible'
        );


        const buttonRect =
            actionButton.getBoundingClientRect();


        const panelRect =
            settingsPanel.getBoundingClientRect();


        const viewportWidth =
            window.innerWidth;


        const viewportHeight =
            window.innerHeight;


        const panelWidth =
            panelRect.width;


        const panelHeight =
            panelRect.height;


        const buttonCenterX =
            buttonRect.left +
            buttonRect.width / 2;


        const buttonCenterY =
            buttonRect.top +
            buttonRect.height / 2;


        const spaceRight =
            viewportWidth -
            buttonRect.right;


        const spaceLeft =
            buttonRect.left;


        const spaceBottom =
            viewportHeight -
            buttonRect.bottom;


        const spaceTop =
            buttonRect.top;


        let left;
        let top;


        if (

            buttonCenterX <
            viewportWidth / 2 &&

            spaceRight >=
            panelWidth +
            PANEL_GAP

        ) {

            left =
                buttonRect.right +
                PANEL_GAP;

        } else if (

            spaceLeft >=
            panelWidth +
            PANEL_GAP

        ) {

            left =
                buttonRect.left -
                panelWidth -
                PANEL_GAP;

        } else {

            left =
                buttonCenterX -
                panelWidth / 2;

        }


        if (

            spaceBottom >=
            panelHeight +
            PANEL_GAP

        ) {

            top =
                buttonRect.bottom +
                PANEL_GAP;

        } else if (

            spaceTop >=
            panelHeight +
            PANEL_GAP

        ) {

            top =
                buttonRect.top -
                panelHeight -
                PANEL_GAP;

        } else {

            top =
                buttonCenterY -
                panelHeight / 2;

        }


        left =
            Math.max(

                8,

                Math.min(

                    left,

                    viewportWidth -
                    panelWidth -
                    8

                )

            );


        top =
            Math.max(

                8,

                Math.min(

                    top,

                    viewportHeight -
                    panelHeight -
                    8

                )

            );


        settingsPanel.style.left =
            left + 'px';


        settingsPanel.style.top =
            top + 'px';


        settingsPanel.style.visibility =
            'visible';

    }


    // ============================================================
    // [SECTION 26] PAUSE OVERLAY
    // ============================================================

    function createPauseOverlay() {

        if (pauseOverlay) {

            return;

        }


        pauseOverlay =
            document.createElement(
                'div'
            );


        pauseOverlay.id =
            'nat-pause-overlay';


        pauseOverlay.innerHTML =

            '<div class="nat-pause-message">' +
                '다음 에피소드를 눌러주세요!' +
            '</div>';


        document.body.appendChild(
            pauseOverlay
        );

    }


    function showPauseOverlay() {

        if (pauseOverlay) {

            pauseOverlay.classList.add(
                'nat-visible'
            );

        }

    }


    function showFallbackOverlay() {

        if (!pauseOverlay) {

            return;

        }


        const message =
            pauseOverlay.querySelector(
                '.nat-pause-message'
            );


        if (message) {

            message.textContent =
                '마우스를 움직이면 다음 화로 자동 이동합니다.';

        }


        pauseOverlay.classList.add(
            'nat-visible'
        );

    }


    function hidePauseOverlay() {

        if (pauseOverlay) {

            pauseOverlay.classList.remove(
                'nat-visible'
            );

        }

    }


    // ============================================================
    // [SECTION 27] MESSAGE
    // ============================================================

    function showMessage(message, success) {

        let box =
            document.getElementById(
                'tm-netflix-test-message'
            );


        if (!box) {

            box =
                document.createElement(
                    'div'
                );


            box.id =
                'tm-netflix-test-message';


            Object.assign(

                box.style,

                {

                    position:
                        'fixed',

                    top:
                        '20px',

                    left:
                        '50%',

                    transform:
                        'translateX(-50%)',

                    zIndex:
                        '2147483647',

                    padding:
                        '12px 20px',

                    borderRadius:
                        '8px',

                    background:
                        '#141414',

                    color:
                        '#fff',

                    fontSize:
                        '14px',

                    fontWeight:
                        '600',

                    boxShadow:
                        '0 4px 15px rgba(0,0,0,0.4)',

                    pointerEvents:
                        'none',

                    whiteSpace:
                        'pre-line'

                }

            );


            document.body.appendChild(
                box
            );

        }


        box.textContent =
            message;


        box.style.border =
            success
                ? '2px solid #46d369'
                : '2px solid #e50914';


        const timeline =
            document.querySelector(
                '[data-uia="timeline"], [data-uia="player-timeline"], .scrubber-container'
            );


        const actionButtonAtTop =
            actionButton &&
            actionButton.getBoundingClientRect().top +
            actionButton.offsetHeight / 2 <
            window.innerHeight / 2;


        if (actionButtonAtTop) {

            box.style.bottom =
                'auto';


            box.style.top =
                '20px';

        } else

        if (timeline) {

            const rect =
                timeline.getBoundingClientRect();


            box.style.bottom =
                'auto';


            box.style.top =
                Math.max(
                    12,
                    rect.top - box.offsetHeight - 12
                ) + 'px';

        } else {

            box.style.top =
                'auto';


            box.style.bottom =
                '110px';

        }


        if (box._removeTimer) {

            clearTimeout(
                box._removeTimer
            );

        }


        box._removeTimer =
            setTimeout(

                function () {

                    if (
                        box &&
                        box.parentNode
                    ) {

                        box.remove();

                    }

                },

                4000

            );

    }


    // ============================================================
    // [SECTION 28] TIME UTILITIES
    // ============================================================

    function formatTime(seconds) {

        const safeSeconds =
            Math.max(

                0,

                Math.floor(
                    Number(seconds) || 0
                )

            );


        const minutes =
            Math.floor(
                safeSeconds / 60
            );


        const remainingSeconds =
            safeSeconds % 60;


        return (

            String(minutes).padStart(2, '0') +
            ':' +
            String(remainingSeconds).padStart(2, '0')

        );

    }


    // ============================================================
    // [SECTION 29] KEYBOARD SHORTCUT
    // ============================================================

    function handleKeyboardShortcut(event) {

        /*
         * T 키 테스트는 디버그 모드에서만 활성화
         */

        if (!settings.debug) {

            return;

        }


        if (
            event.key.toLowerCase() !== 't'
        ) {

            return;

        }


        if (

            event.ctrlKey ||
            event.altKey ||
            event.shiftKey

        ) {

            return;

        }


        event.preventDefault();


        event.stopPropagation();


        debugLog(
            'T 키 감지 → Credits → Next 테스트 실행'
        );


        runDebugCreditsTest();

    }


    // ============================================================
    // [SECTION 30] MONITOR
    // ============================================================

    function showGuideOverlay() {

        if (!isWatchPage) {
            return;
        }

        if (guideOverlay) {
            return;
        }


        const helpPopup =
            settingsPanel && settingsPanel.querySelector(
                '#nat-help-popup'
            );


        if (helpPopup) {
            helpPopup.hidden =
                true;
        }


        closeSettingsPanel();


        const guideVideo =
            findVideoElement();


        const shouldResumeVideo =
            guideVideo &&
            !guideVideo.paused &&
            !guideVideo.ended;


        if (shouldResumeVideo) {
            guideVideo.pause();
        }


        const steps = [
            ['NAS 플로팅 버튼', '클릭하면 설정 창을 엽니다. 드래그로 위치를 옮기고, 휠로 투명도를 조절하며, 우클릭으로 NAS 전체를 켜고 끕니다.', 'button'],
            ['전체 자동화', '오른쪽 위 토글은 NAS 전체 기능을 켜고 끕니다. 켜짐 상태에서는 플로팅 버튼이 빨간색으로 표시됩니다.', 'master'],
            ['오프닝 / 줄거리 스킵', '전체 영상의 20% 또는 최대 6분 중 더 짧은 구간에서 넷플릭스의 줄거리·오프닝 건너뛰기 버튼을 각각 자동으로 처리합니다.', 'intro'],
            ['크레딧 스킵', '크레딧 보기 버튼이 있으면 다음 화로 이동합니다. 버튼이 없는 콘텐츠는 타임라인 ▼ 마커를 드래그해 유도 시간을 저장하세요. 마커 위 시간은 저장될 시점입니다.', 'credit']
        ];

        let stepIndex = 0;
        guideOverlay = document.createElement('div');
        guideOverlay.id = 'nat-guide-overlay';
        document.body.appendChild(guideOverlay);

        function closeGuide() {
            localStorage.setItem('netflixAutoSkipGuideSeen', 'true');
            guideOverlay.remove();
            guideOverlay = null;

            closeSettingsPanel();


            if (shouldResumeVideo) {
                guideVideo.play().catch(
                    function () {}
                );
            }
        }

        function renderStep() {
            const step = steps[stepIndex];
            const isLast = stepIndex === steps.length - 1;

            if (step[2] === 'button') {
                closeSettingsPanel();
            } else {
                openSettingsPanel();
            }

            const target =
                step[2] === 'button'
                    ? actionButton
                    : step[2] === 'master'
                        ? settingsPanel.querySelector('#nat-master-enabled').closest('.nat-panel-header')
                        : step[2] === 'intro'
                            ? settingsPanel.querySelector('#nat-intro-enabled').closest('.nat-section')
                            : settingsPanel.querySelector('#nat-credit-enabled').closest('.nat-section');

            const rect = target.getBoundingClientRect();

            guideOverlay.innerHTML =
                '<div class="nat-guide-spotlight"></div>' +
                '<div class="nat-guide-card">' +
                    '<div class="nat-guide-step">' + (stepIndex + 1) + ' / ' + steps.length + '</div>' +
                    '<div class="nat-guide-title">' + step[0] + '</div>' +
                    '<div class="nat-guide-body">' + step[1] + '</div>' +
                    '<div class="nat-guide-actions">' +
                        '<button type="button" data-guide="close">건너뛰기</button>' +
                        '<button type="button" class="nat-guide-primary" data-guide="next">' +
                            (isLast ? '완료' : '다음') +
                        '</button>' +
                    '</div>' +
                '</div>';

            const spotlight = guideOverlay.querySelector('.nat-guide-spotlight');
            spotlight.style.left = (rect.left - 6) + 'px';
            spotlight.style.top = (rect.top - 6) + 'px';
            spotlight.style.width = (rect.width + 12) + 'px';
            spotlight.style.height = (rect.height + 12) + 'px';

            const card = guideOverlay.querySelector('.nat-guide-card');

            if (step[2] !== 'button') {
                const panelRect = settingsPanel.getBoundingClientRect();
                card.style.left = Math.min(
                    window.innerWidth - card.offsetWidth - 16,
                    panelRect.right + 18
                ) + 'px';
                card.style.top = Math.max(
                    16,
                    Math.min(
                        window.innerHeight - card.offsetHeight - 16,
                        rect.top
                    )
                ) + 'px';
            } else {
                card.style.left = Math.max(16, Math.min(window.innerWidth - card.offsetWidth - 16, rect.left)) + 'px';
                card.style.top = rect.top > window.innerHeight / 2
                    ? Math.max(16, rect.top - card.offsetHeight - 18) + 'px'
                    : Math.min(window.innerHeight - card.offsetHeight - 16, rect.bottom + 18) + 'px';
            }

            guideOverlay.querySelector('[data-guide="close"]').addEventListener('click', closeGuide);
            guideOverlay.querySelector('[data-guide="next"]').addEventListener(
                'click',
                function () {
                    if (isLast) {
                        closeGuide();
                    } else {
                        stepIndex++;
                        renderStep();
                    }
                }
            );
        }

        renderStep();
    }


    function maybeShowGuideOverlay() {
        if (
            isWatchPage &&
            localStorage.getItem('netflixAutoSkipGuideSeen') !== 'true'
        ) {
            showGuideOverlay();
        }
    }


    function monitorVideo() {

        detectRouteChange();


        if (

            !isWatchPage ||
            !automationRunning

        ) {

            return;

        }


        const video =
            detectVideo();


        if (!video) {

            return;

        }


        trySkipIntro(video);


        checkFallbackTimeLength(video);


        updateFallbackTimeMarker(video);


        tryCreditAction(video);

    }


    // ============================================================
    // [SECTION 31] INITIALIZATION
    // ============================================================

    function initialize() {

        createStyle();


        createActionButton();


        keepActionButtonInViewport();


        createSettingsPanel();


        createPauseOverlay();


        initializeFullscreenUiSupport();


        window.addEventListener('pagehide', stopNextEpisodeRetry);


        document.addEventListener(

            'keydown',

            handleKeyboardShortcut,

            true

        );


        isWatchPage =
            isNetflixWatchPage();


        if (

            isWatchPage &&
            settings.masterEnabled

        ) {

            startAutomation();

        }


        setTimeout(
            maybeShowGuideOverlay,
            500
        );


        setInterval(

            monitorVideo,

            CHECK_INTERVAL

        );


        window.addEventListener(

            'resize',

            function () {

                keepActionButtonInViewport();

                if (isPanelOpen) {

                    positionSettingsPanel();

                }

            }

        );


        debugLog(
            SCRIPT_NAME +
            ' v' +
            VERSION +
            ' 초기화 완료'
        );

    }


    if (
        document.readyState === 'loading'
    ) {

        document.addEventListener(
            'DOMContentLoaded',
            initialize
        );

    } else {

        initialize();

    }

})();
