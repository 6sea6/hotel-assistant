!ifndef BUILD_UNINSTALLER
  !include LogicLib.nsh
  !include MUI2.nsh
  !include nsDialogs.nsh

  Var DesktopShortcutCheckbox
  Var DesktopShortcutState

  !macro customInit
    StrCpy $DesktopShortcutState ${BST_CHECKED}
  !macroend

  !macro customPageAfterChangeDir
    Page custom desktopShortcutOptionsPageCreate desktopShortcutOptionsPageLeave
  !macroend

  Function desktopShortcutOptionsPageCreate
    ${If} ${Silent}
      Abort
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "快捷方式" "选择是否创建桌面快捷方式"

    nsDialogs::Create 1018
    Pop $0

    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 24u "请选择安装完成后是否在桌面创建快捷方式。"
    Pop $0

    ${NSD_CreateCheckbox} 0 34u 100% 12u "创建桌面快捷方式"
    Pop $DesktopShortcutCheckbox

    ${If} $DesktopShortcutState == ${BST_UNCHECKED}
      ${NSD_Uncheck} $DesktopShortcutCheckbox
    ${Else}
      ${NSD_Check} $DesktopShortcutCheckbox
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function desktopShortcutOptionsPageLeave
    ${NSD_GetState} $DesktopShortcutCheckbox $DesktopShortcutState
  FunctionEnd

  !macro customInstall
    ${If} $DesktopShortcutState == ${BST_UNCHECKED}
      Delete "$newDesktopLink"
      ClearErrors
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    ${EndIf}
  !macroend
!endif
