use crate::coolapk::client::{CoolapkClient, DeviceProfile};
use serde_json::{Value, json};

macro_rules! shared_commands {
    ($($mode:ident fn $name:ident(
        $state:ident $(, $arg:ident: $ty:ty)* $(,)?
    ) -> $result:ty $body:block)*) => {
        pub(crate) async fn dispatch_web_command(
            client: &CoolapkClient, command: &str, args: Value,
        ) -> Result<Value, String> {
            struct WebState<'a> { client: &'a CoolapkClient }
            match command {
                $(stringify!($name) => {
                    #[derive(serde::Deserialize)]
                    #[serde(rename_all = "camelCase")]
                    struct Args { $($arg: $ty),* }
                    let Args { $($arg),* } = serde_json::from_value(args)
                        .map_err(|_| "请求参数无效".to_string())?;
                    let $state = WebState { client };
                    let result: Result<$result, String> =
                        shared_commands!(@call $mode $body);
                    serde_json::to_value(result?).map_err(|_| "响应序列化失败".to_string())
                })*
                _ => Err("当前平台不支持此操作".into()),
            }
        }
    };
    (@call async $body:block) => { (async move $body).await };
    (@call sync $body:block) => { (|| $body)() };
}

include!("shared_commands.rs");
