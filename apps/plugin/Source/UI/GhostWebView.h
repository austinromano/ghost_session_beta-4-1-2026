#pragma once

#include "JuceHeader.h"

class GhostSessionProcessor;

//==============================================================================
/**
 * Custom WebBrowserComponent that intercepts ghost:// URLs
 * to handle native drag-to-DAW and recording operations,
 * and pushes real-time audio levels to the React UI.
 */
class GhostWebView : public juce::WebBrowserComponent,
                     private juce::Timer
{
public:
    GhostWebView(const Options& options, GhostSessionProcessor& processor);

    bool pageAboutToLoad(const juce::String& newURL) override;

private:
    juce::File tempDir;
    GhostSessionProcessor& proc;

    void timerCallback() override;

    void handleDragToDaw(const juce::String& urlString);
    void handleStartRecording();
    void handleStopRecording();

    juce::File downloadToTemp(const juce::String& downloadUrl, const juce::String& fileName);

    // Parse a query parameter from a URL string
    static juce::String getQueryParam(const juce::String& url, const juce::String& paramName);

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(GhostWebView)
};
