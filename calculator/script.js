// 计算器状态
let currentOperand = '0';
let previousOperand = '';
let operation = undefined;
let shouldResetScreen = false;

// 获取显示元素
const currentOperandElement = document.querySelector('.current-operand');
const previousOperandElement = document.querySelector('.previous-operand');

/**
 * 添加数字到当前操作数
 */
function appendNumber(number) {
    // 如果刚计算完或选择运算符后，重置屏幕
    if (shouldResetScreen) {
        currentOperand = '';
        shouldResetScreen = false;
    }
    
    // 防止多个小数点
    if (number === '.' && currentOperand.includes('.')) return;
    
    // 防止开头的多个零
    if (currentOperand === '0' && number !== '.') {
        currentOperand = number;
    } else {
        currentOperand += number;
    }
    
    // 限制最大长度
    if (currentOperand.length > 15) {
        currentOperand = currentOperand.slice(0, 15);
    }
    
    updateDisplay();
}

/**
 * 添加运算符
 */
function appendOperator(operator) {
    // 如果之前没有操作数，不能进行运算
    if (currentOperand === '' && operator !== '-') {
        return;
    }
    
    // 如果已经有之前的操作数和运算符，先计算
    if (previousOperand !== '' && operation !== undefined) {
        calculate();
    }
    
    // 处理百分比运算符
    if (operator === '%') {
        currentOperand = String(parseFloat(currentOperand) / 100);
        updateDisplay();
        return;
    }
    
    operation = operator;
    previousOperand = currentOperand;
    shouldResetScreen = true;
    updateDisplay();
}

/**
 * 切换正负号
 */
function toggleSign() {
    if (currentOperand === '0') return;
    currentOperand = String(parseFloat(currentOperand) * -1);
    updateDisplay();
}

/**
 * 执行计算
 */
function calculate() {
    if (operation === undefined || shouldResetScreen) return;
    
    let result;
    const prev = parseFloat(previousOperand);
    const current = parseFloat(currentOperand);
    
    // 检查是否为有效数字
    if (isNaN(prev) || isNaN(current)) {
        clearAll();
        return;
    }
    
    // 执行对应的运算
    switch (operation) {
        case '+':
            result = prev + current;
            break;
        case '-':
            result = prev - current;
            break;
        case '×':
            result = prev * current;
            break;
        case '÷':
            if (current === 0) {
                showError('不能除以零');
                return;
            }
            result = prev / current;
            break;
        default:
            return;
    }
    
    // 处理精度问题，最多保留10位小数
    result = parseFloat(result.toFixed(10));
    
    // 检查结果是否溢出或为无穷大
    if (!isFinite(result)) {
        showError('结果溢出');
        return;
    }
    
    currentOperand = String(result);
    operation = undefined;
    previousOperand = '';
    shouldResetScreen = true;
    updateDisplay();
}

/**
 * 清除所有
 */
function clearAll() {
    currentOperand = '0';
    previousOperand = '';
    operation = undefined;
    shouldResetScreen = false;
    updateDisplay();
}

/**
 * 删除最后一个字符
 */
function deleteNumber() {
    if (shouldResetScreen) {
        clearAll();
        return;
    }
    
    if (currentOperand.length === 1) {
        currentOperand = '0';
    } else {
        currentOperand = currentOperand.slice(0, -1);
    }
    updateDisplay();
}

/**
 * 显示错误信息
 */
function showError(message) {
    currentOperand = message;
    previousOperand = '';
    operation = undefined;
    shouldResetScreen = true;
    updateDisplay();
}

/**
 * 格式化数字显示（添加千位分隔符）
 */
function formatNumber(number) {
    // 如果是错误信息，直接返回
    if (isNaN(parseFloat(number))) {
        return number;
    }
    
    const parts = number.toString().split('.');
    const integerPart = parseFloat(parts[0]).toLocaleString('en-US', {
        maximumFractionDigits: 0
    });
    
    return parts.length === 1 ? integerPart : integerPart + '.' + parts[1];
}

/**
 * 更新显示
 */
function updateDisplay() {
    currentOperandElement.textContent = formatNumber(currentOperand);
    
    if (operation != null) {
        previousOperandElement.textContent = `${formatNumber(previousOperand)} ${operation}`;
    } else {
        previousOperandElement.textContent = '';
    }
}

/**
 * 键盘支持
 */
document.addEventListener('keydown', (event) => {
    const key = event.key;
    
    // 数字和小数点
    if (/[0-9.]/.test(key)) {
        appendNumber(key);
    }
    // 运算符
    else if (key === '+' || key === '-') {
        appendOperator(key);
    }
    else if (key === '*') {
        appendOperator('×');
    }
    else if (key === '/') {
        event.preventDefault(); // 防止触发浏览器搜索
        appendOperator('÷');
    }
    // 回车或等号
    else if (key === 'Enter' || key === '=') {
        event.preventDefault();
        calculate();
    }
    // 退格
    else if (key === 'Backspace') {
        deleteNumber();
    }
    // Escape 或 C 清除
    else if (key === 'Escape' || key.toLowerCase() === 'c') {
        clearAll();
    }
});

// 初始化显示
updateDisplay();