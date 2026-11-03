package dev.sgsng.game

import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        // 界面声明返回动作；原生只分发弹窗取消或按钮点击，不判断房间与规则状态。
        webView.evaluateJavascript("""
          (() => {
            const dialog = document.activeElement?.closest('dialog[open]') ??
              [...document.querySelectorAll('dialog[open]')].at(-1);
            if (dialog) {
              if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
              return true;
            }
            const target = [...document.querySelectorAll('[data-back-action]:not(:disabled)')]
              .find(node => node.getClientRects().length &&
                getComputedStyle(node).visibility !== 'hidden' && !node.closest('[inert]'));
            if (!target) return false;
            target.click();
            return true;
          })()
        """.trimIndent()) { handled ->
          if (handled != "true") {
            moveTaskToBack(true)
          }
        }
      }
    })
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    val content = findViewById<View>(android.R.id.content)
    content.setBackgroundColor(Color.rgb(17, 27, 26))
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      // 整个 WebView 位于可操作区域；扣除已处理的边距，避免子视图再次留白，保留 IME 等剩余 inset。
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      insets.inset(bars.left, bars.top, bars.right, bars.bottom)
    }
    ViewCompat.requestApplyInsets(content)

    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = false
      isAppearanceLightNavigationBars = false
    }
  }
}
